// Git helpers for a workflow's workspace. The orchestrator commits each finished step to a
// branch and uses the diff to enforce folder ownership. It never pushes.
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

const BOT = ['-c', 'user.name=tandembridge', '-c', 'user.email=tandembridge@localhost'];
// Never committed. .bridge holds result files; the rest are build output and secrets.
const EXCLUDES = ['.bridge/', 'node_modules/', '.env', 'dist/', 'build/', 'coverage/'];

const git = (cwd, args) => new Promise((resolve, reject) => {
  execFile('git', args, { cwd, windowsHide: true, maxBuffer: 32 * 1024 * 1024 }, (err, stdout, stderr) => {
    if (err) { err.message = `git ${args[0]}: ${(stderr || err.message).trim()}`; return reject(err); }
    resolve(stdout);
  });
});

async function hasHead(cwd) {
  try { await git(cwd, ['rev-parse', '--verify', 'HEAD']); return true; } catch (e) { return false; }
}

// Creates or validates the workspace, then moves it onto the workflow branch.
async function prepareWorkspace(workspace, branch) {
  fs.mkdirSync(workspace, { recursive: true });
  if (!fs.existsSync(path.join(workspace, '.git'))) await git(workspace, ['init']);

  const excludeFile = path.join(workspace, '.git', 'info', 'exclude');
  fs.mkdirSync(path.dirname(excludeFile), { recursive: true });
  const current = fs.existsSync(excludeFile) ? fs.readFileSync(excludeFile, 'utf8') : '';
  const missing = EXCLUDES.filter((e) => !current.split(/\r?\n/).includes(e));
  if (missing.length) fs.appendFileSync(excludeFile, '\n' + missing.join('\n') + '\n');
  fs.mkdirSync(path.join(workspace, '.bridge'), { recursive: true });

  if (!(await hasHead(workspace))) {
    await git(workspace, [...BOT, 'commit', '--allow-empty', '-m', 'bridge: workspace start']);
  }
  const dirty = (await git(workspace, ['status', '--porcelain'])).trim();
  if (dirty) throw new Error(`workspace has uncommitted changes, commit or stash them first:\n${dirty}`);
  await git(workspace, ['switch', '-c', branch]);
}

const head = async (cwd) => (await git(cwd, ['rev-parse', 'HEAD'])).trim();

// Every path touched since `base`, committed or not, renames included.
async function changedFiles(cwd, base) {
  const files = new Set();
  (await git(cwd, ['diff', '--name-only', '-z', base, 'HEAD'])).split('\0').filter(Boolean).forEach((f) => files.add(f));
  const fields = (await git(cwd, ['status', '--porcelain', '-z', '-uall'])).split('\0').filter(Boolean);
  for (let i = 0; i < fields.length; i++) {
    const x = fields[i][0];
    files.add(fields[i].slice(3));
    if (x === 'R' || x === 'C') files.add(fields[++i]);       // -z puts the old name in the next field
  }
  return [...files];
}

// git status cannot see ignored files such as .env, so the scope check would miss an agent
// changing them. This records them to compare later. Build output is left out because every
// build rewrites it.
async function ignoredFiles(cwd) {
  const out = await git(cwd, ['ls-files', '--others', '--ignored', '--exclude-standard', '--directory', '-z']);
  const found = new Map();
  for (const f of out.split('\0').filter(Boolean)) {
    if (/(^|\/)(node_modules|dist|build|coverage|\.bridge)(\/|$)/.test(f)) continue;
    try {
      const s = fs.statSync(path.join(cwd, f));
      found.set(f.replace(/\/$/, ''), `${s.mtimeMs}:${s.size}`);
    } catch (e) { /* removed while listing */ }
  }
  return found;
}

// npm can leave an empty lockfile in a root with no package.json. It holds nothing and belongs
// to no agent, so it should not fail a step. Any lockfile with real content stays.
function removeEmptyRootLock(cwd) {
  const lock = path.join(cwd, 'package-lock.json');
  if (fs.existsSync(path.join(cwd, 'package.json')) || !fs.existsSync(lock)) return false;
  try {
    const { packages } = JSON.parse(fs.readFileSync(lock, 'utf8'));
    if (!packages || Object.keys(packages).length > 0) return false;
  } catch (e) { return false; }
  fs.rmSync(lock);
  return true;
}

// A scope entry is a folder ('backend/') or one exact file ('docs/API_CONTRACT.md').
const inScope = (file, scope) =>
  scope.some((s) => (s.endsWith('/') ? file.startsWith(s) : file === s));

async function commitAll(cwd, message) {
  await git(cwd, ['add', '-A']);
  try {
    await git(cwd, ['diff', '--cached', '--quiet']);
    return null;                                              // exit 0: nothing staged
  } catch (e) {
    if (e.code !== 1) throw e;
  }
  await git(cwd, [...BOT, 'commit', '-m', message]);
  return head(cwd);
}

module.exports = { git, prepareWorkspace, head, changedFiles, inScope, commitAll, removeEmptyRootLock, ignoredFiles };
