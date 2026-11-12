// How the orchestrator reaches each agent.
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { claudeChoice } = require('../config/usage');
const { createLiveLog, claudeReader, announceLive, saveClaudeLimits } = require('./live');
const { openWatchWindow } = require('./watch');

const short = (s, n = 500) => (typeof s === 'string' && s.length > n ? s.slice(0, n) + '...' : s);

// Env vars from an IDE or a parent Claude session break the child CLIs. npm_* vars from
// `npm run` leak settings too: --silent there would erase the error output of every check.
function cleanEnv() {
  const env = { ...process.env };
  for (const k of Object.keys(env)) {
    if (k === 'CLAUDECODE' || k === 'ELECTRON_RUN_AS_NODE' || k.startsWith('CLAUDE_CODE_') || k.startsWith('VSCODE_') || /^npm_/i.test(k)) delete env[k];
  }
  return env;
}

function killTree(child) {
  if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
  else child.kill('SIGKILL');
}

// Runs a .cmd shim with every argument quoted. Arguments here come from config, never from
// task content: prompts travel over stdin.
function spawnCli(bin, args, opts) {
  if (process.platform !== 'win32') return spawn(bin, args, { ...opts, windowsHide: true });
  const line = [bin, ...args].map((a) => `"${String(a).replace(/"/g, '\\"')}"`).join(' ');
  return spawn('cmd.exe', ['/d', '/s', '/c', `"${line}"`],
    { ...opts, windowsHide: true, windowsVerbatimArguments: true });
}

function runCli(bin, args, { cwd, input, timeoutMs, direct, onLine }) {
  let child, kill;
  const done = new Promise((resolve) => {
    const started = Date.now();
    // A real .exe skips cmd.exe entirely, so task text in an argument is never parsed by a shell.
    child = direct
      ? spawn(bin, args, { cwd, env: cleanEnv(), windowsHide: true })
      : spawnCli(bin, args, { cwd, env: cleanEnv() });
    let out = '', err = '', timedOut = false;
    kill = () => killTree(child);
    const timer = setTimeout(() => { timedOut = true; kill(); }, timeoutMs);
    let pending = '';
    child.stdout.on('data', (d) => {
      out += d;
      if (!onLine) return;
      pending += d;
      const lines = pending.split('\n');
      pending = lines.pop();
      lines.filter((l) => l.trim()).forEach(onLine);
    });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => { clearTimeout(timer); resolve({ code: null, out, err: e.message, timedOut, ms: Date.now() - started }); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, out, err, timedOut, ms: Date.now() - started }); });
    child.stdin.on('error', () => {});
    child.stdin.end(input || '');
  });
  return { done, kill };
}

// What kind of failure was this? Decides between waiting, asking the owner, or retrying.
function classifyFailure(text) {
  const t = String(text || '');
  if (/budget/i.test(t)) return 'budget';
  if (/usage limit|limit reached|hit your .*limit|rate.?limit|quota|too many requests|\b429\b|overloaded|credit balance/i.test(t)) return 'quota';
  if (/not logged in|please run \/login|invalid api key|authentication|unauthorized/i.test(t)) return 'auth';
  if (/ENOTFOUND|ECONNRESET|ETIMEDOUT|EAI_AGAIN|fetch failed|network|connection error/i.test(t)) return 'network';
  return 'error';
}

// The final result of a streamed Claude run; its fields match the plain JSON format.
function parseClaudeOut(out) {
  let parsed = null;
  for (const line of String(out).split('\n')) {
    if (!line.trim()) continue;
    try {
      const j = JSON.parse(line);
      if (j.type === 'result' || (!j.type && !parsed)) parsed = j;
    } catch (e) { /* partial or non-JSON line */ }
  }
  return parsed;
}

function createClaudeExecutor(config, { exec = runCli } = {}) {
  return {
    start(prompt, workspace, payload, { kind } = {}) {
      const { model, effort } = claudeChoice(config, kind);
      // Streamed so the step can be watched live, and so the plan's limits are seen on every run.
      const args = ['-p', '--output-format', 'stream-json', '--verbose',
        ...(model ? ['--model', model] : []),
        ...(effort ? ['--effort', effort] : []),
        '--max-budget-usd', config.taskBudgetUsd,
        '--permission-mode', 'acceptEdits',
        '--permission-prompts', 'none',
        '--allowedTools', config.claudeAllowedTools.join(','),
        '--disallowedTools', config.claudeDeniedTools.join(',')];
      let live = null;
      let read = null;
      const onLine = (line) => {
        let e;
        try { e = JSON.parse(line); } catch (err) { return; }
        if (e.type === 'rate_limit_event') { saveClaudeLimits(e.rate_limit_info); return; }
        if (!live && e.session_id) {
          live = createLiveLog(config.liveDir || path.join(os.tmpdir(), 'tandembridge-live'), e.session_id,
            { title: (payload && payload.title) || 'step', workspace, agent: 'Claude Code', model: e.model || model });
          announceLive(workspace, live.file);
          openWatchWindow(config);
          read = claudeReader(live, workspace);
        }
        if (read) read(e);
      };
      const run = exec(config.claudeBin, args, { cwd: workspace, input: prompt, timeoutMs: config.claudeTimeoutMs, onLine });
      return {
        kill: run.kill,
        done: run.done.then((r) => {
          const parsed = parseClaudeOut(r.out);
          const ok = r.code === 0 && !!parsed && !parsed.is_error;
          if (live) live.end(ok ? '' : `Stopped: ${short(String((parsed && parsed.result) || r.err || 'error'), 300)}`);
          const errorText = ok ? '' : [r.timedOut && 'timeout', parsed && parsed.subtype, parsed && parsed.result, r.err, !parsed && r.out]
            .filter(Boolean).join(' | ');
          return {
            ok,
            duration_ms: r.ms,
            summary: short(parsed && parsed.result),
            cost_usd: (parsed && parsed.total_cost_usd) || 0,
            session_id: parsed && parsed.session_id,
            live_log: live ? live.file : undefined,
            error: short(errorText, 600),
            failure: ok ? null : r.timedOut ? 'error' : classifyFailure(errorText)
          };
        })
      };
    }
  };
}

// The commands Antigravity may run: exact matches only, one set per project folder it works in.
// agy has no prefix rules short of allowing every command, which is what this avoids.
// One denied command ends the whole agy run, so the forms it reaches for must all be listed.
function agyCommands(scope) {
  const verbs = ['install', 'run build', 'test', 'run lint', 'run typecheck'];
  // A step may own only part of a project (frontend/src/pages/), but npm runs at the top.
  const dirs = [...new Set(scope.filter((s) => s.includes('/')).flatMap((s) => {
    const top = s.split('/')[0];
    return s.endsWith('/') ? [s.slice(0, -1), top] : [top];
  }))];
  // agy has no delete tool, so an exact file in scope is the only way to allow removing one.
  const deletes = scope.filter((s) => !s.endsWith('/')).map((f) => `git rm -f -- ${/\s/.test(f) ? `"${f}"` : f}`);
  return [...dirs.flatMap((d) => [`cd ${d} && npm install`, ...verbs.map((v) => `npm --prefix ${d} ${v}`)]), ...deletes];
}

// agy reports status SUCCESS even when every tool was denied and it did nothing,
// so an empty response counts as a failure.
function parseAgyRun(r) {
  // Streamed output ends with a result event; its fields match the plain JSON format.
  let parsed = null;
  for (const line of String(r.out).split('\n').filter((l) => l.trim())) {
    try {
      const j = JSON.parse(line);
      parsed = j.event === 'result' ? j.result : j.event ? parsed : j;
    } catch (e) { /* partial or non-JSON line */ }
  }
  const response = parsed && parsed.response ? String(parsed.response) : '';
  const denied = (parsed && parsed.denied_actions) || [];
  const ok = r.code === 0 && !!parsed && parsed.status === 'SUCCESS' && response.trim().length > 0;
  const errorText = ok ? '' : [r.timedOut && 'timeout',
    parsed && parsed.status !== 'SUCCESS' && parsed.status,
    denied.length && `permission denied for: ${denied.map((d) => d.display_name || d.action).join(', ')}`,
    r.err, !parsed && r.out].filter(Boolean).join(' | ');
  return {
    ok,
    duration_ms: r.ms,
    summary: short(response),
    cost_usd: 0,
    session_id: parsed && parsed.conversation_id,
    error: short(errorText, 600),
    failure: ok ? null : r.timedOut || denied.length ? 'error' : classifyFailure(errorText)
  };
}

// agy does the work, because it is reliable and reports real failures. The same conversation
// is then opened in the project's own IDE window so the owner can watch it, and its progress
// also goes to the orchestrator's terminal in case the panel does not show it.
function createAntigravityExecutor(config, { exec = runCli, ide, log = () => {} } = {}) {
  const runIde = ide || ((args) => {
    const child = spawnCli(config.antigravityCli, args, { stdio: 'ignore', env: cleanEnv() });
    child.on('error', () => {});
    child.unref();
  });
  return {
    start(prompt, workspace, payload) {
      const commands = agyCommands(payload.scope);
      const settings = JSON.stringify({ permissions: { allow: commands.map((c) => `command(${c})`) } });
      const tools = 'Use your file tools, never the shell, to read and list files.';
      const note = commands.length
        ? `\n\nShell commands: run only the commands listed here, from the workspace root, one at a time and exactly as written. Do not combine them with each other, and do not run anything else (no Get-ChildItem, ls, dir, echo, cat, or powershell). One command outside this list ends your whole run. ${tools}\n${commands.map((c) => `- ${c}`).join('\n')}`
        : `\n\nYou cannot run shell commands in this step. Any shell command ends your whole run. ${tools}`;
      const args = ['-p', prompt + note, '--output-format', 'stream-json', '--mode', 'accept-edits',
        '--model', config.agyModel, '--settings', settings];

      runIde(['--new-window', workspace]);
      let conversation = null;
      let live = null;
      let said = '';
      let blocked = null;
      const onLine = (line) => {
        let e;
        try { e = JSON.parse(line); } catch (err) { return; }
        if (!conversation && e.conversation_id) {
          conversation = e.conversation_id;
          live = createLiveLog(config.liveDir || path.join(os.tmpdir(), 'tandembridge-live'), conversation,
            { title: (payload && payload.title) || 'step', workspace, agent: 'Antigravity', model: config.agyModel });
          // The IDE's agent panel cannot follow a CLI conversation, so the extension in the
          // project's window finds this live log through the index and shows it.
          announceLive(workspace, live.file);
          openWatchWindow(config);
          log(`antigravity conversation ${conversation}: live view in its IDE window, log ${live.file}`);
        }
        if (live) live.event(e);
        const u = e.step_update;
        if (!u) return;
        if (u.step_type === 'agent_response') {
          said += u.text_delta || '';
          if (u.state === 'DONE' && said.trim()) {
            log(`antigravity: ${short(said.trim().replace(/\s+/g, ' '), 300)}`);
            said = '';
          }
        } else if (u.step_type === 'tool' && u.state === 'DONE') {
          log(`antigravity did: ${u.tool_name}`);
        } else if (u.step_type === 'tool' && u.state === 'ERROR') {
          const why = u.tool_info && u.tool_info.error && u.tool_info.error.message;
          if (why && u.tool_name === 'run_command' && /permission check failed/.test(why)) blocked = short(why.replace(/\s+/g, ' '), 200);
          log(`antigravity tool error: ${u.tool_name}${why ? ` (${short(why.replace(/\s+/g, ' '), 160)})` : ''}`);
        }
      };
      const run = exec(config.agyBin, args, { cwd: workspace, timeoutMs: config.agyTimeoutMs, direct: true, onLine });
      // agy's own error only says "RunCommand". The retry needs to know which command to avoid.
      const report = (r) => {
        const res = { ...parseAgyRun(r), live_log: live ? live.file : undefined };
        if (live) live.end(res.ok ? '' : `Stopped: ${res.error}`);
        return blocked && !res.ok ? { ...res, error: short(`This command is not allowed, do not run it again: ${blocked} | ${res.error}`, 600) } : res;
      };
      return { kill: run.kill, done: run.done.then(report) };
    }
  };
}

// Stands in for both agents under TANDEMBRIDGE_DRY_RUN=1. Spends no quota.
function createDryRunExecutors() {
  const agent = {
    start(prompt) {
      const m = prompt.match(/RESULT_FILE: (.+)/);
      fs.writeFileSync(m[1].trim(), JSON.stringify({ status: 'done', summary: 'dry-run: agent not invoked' }));
      return { kill() {}, done: Promise.resolve({ ok: true, duration_ms: 1, summary: 'dry-run', cost_usd: 0, failure: null }) };
    }
  };
  return new Proxy({}, { get: () => agent });          // stands in for every agent id
}

module.exports = { runCli, classifyFailure, cleanEnv, parseAgyRun, parseClaudeOut, agyCommands, createClaudeExecutor, createAntigravityExecutor, createDryRunExecutors };
