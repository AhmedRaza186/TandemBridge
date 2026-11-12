const vscode = require('vscode');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { parseLog, html } = require('./view');

// Shows what a TandemBridge step is doing, live, in this project's window. The agy CLI keeps its
// conversations in its own store, which the IDE's agent panel cannot read, so the orchestrator
// writes a live log and this extension follows it in its own side panel, "TandemBridge", and in an
// Output channel of the same name. It sends nothing to the agent.
//
// The orchestrator lists each project's current log in one index file. Every window checks it for
// its own project, so nothing depends on which window a link would reach or how fast it loads.
const INDEX = path.join(os.homedir(), '.tandembridge', 'live.json');
const LOG_FILE = path.join(os.tmpdir(), 'tandembridge-extension.log');
const CHECK_MS = 1000;
const POLL_MS = 500;
const FRESH_MS = 10 * 60 * 1000;            // a finished log older than this is not shown on open
const GIVE_UP_MS = 2 * 60 * 60 * 1000;      // stop following a log that stopped growing this long ago

function log(line) {
  try {
    fs.appendFileSync(LOG_FILE, `${new Date().toISOString()} ${line}\n`);
  } catch (e) {
    console.error('tandembridge: log write failed:', e.message);
  }
}

const normalize = (p) => path.resolve(p).toLowerCase();
const myWorkspaces = () => (vscode.workspace.workspaceFolders || []).map((f) => normalize(f.uri.fsPath));
// Only a TandemBridge live log, never an arbitrary file named in the index.
const isLiveLog = (file) => typeof file === 'string' && path.isAbsolute(file) && /[\\/]live[\\/][\w-]+\.log$/.test(file);

let channel = null;
let view = null;          // the side panel, once the IDE has drawn it
let text = '';
let following = null;     // { file, timer }
let shownFile = null;
let indexMtime = 0;

const VIEW_ID = 'tandembridge.live';
// How much of the Claude plan is left, saved by the orchestrator after every Claude run.
const LIMITS = path.join(os.homedir(), '.tandembridge', 'limits.json');
let limitsMtime = 0;
const readLimits = () => {
  try { return JSON.parse(fs.readFileSync(LIMITS, 'utf8')).claude || null; } catch (e) { return null; }
};
const draw = () => { if (view) view.webview.postMessage({ ...parseLog(text), limits: readLimits() }); };

function stopFollowing() {
  if (following) clearInterval(following.timer);
  following = null;
}

// Appends whatever the log gained since the last look, until it ends.
function follow(file) {
  stopFollowing();
  shownFile = file;
  channel.clear();
  text = '';
  draw();
  // Bring the panel into view without taking the cursor from the editor.
  if (view) view.show(true);
  else vscode.commands.executeCommand(`${VIEW_ID}.focus`).then(undefined, () => channel.show(true));
  let offset = 0;
  let lastGrowth = Date.now();
  const timer = setInterval(() => {
    let size;
    try { size = fs.statSync(file).size; } catch (e) { return; }
    if (size > offset) {
      const fd = fs.openSync(file, 'r');
      const buf = Buffer.alloc(size - offset);
      fs.readSync(fd, buf, 0, buf.length, offset);
      fs.closeSync(fd);
      offset = size;
      lastGrowth = Date.now();
      const added = buf.toString('utf8');
      text += added;
      channel.append(added);
      draw();
      if (/\[end\]\r?\n?$/.test(added)) stopFollowing();
    } else if (Date.now() - lastGrowth > GIVE_UP_MS) {
      stopFollowing();
    }
  }, POLL_MS);
  following = { file, timer };
  log(`following ${file}`);
}

const ended = (file) => {
  try {
    const size = fs.statSync(file).size;
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(Math.min(size, 64));
    fs.readSync(fd, buf, 0, buf.length, Math.max(0, size - buf.length));
    fs.closeSync(fd);
    return /\[end\]\r?\n?$/.test(buf.toString('utf8'));
  } catch (e) { return true; }
};

// Looks for a new log for this window's project.
function check() {
  try {
    const m = fs.statSync(LIMITS).mtimeMs;
    if (m !== limitsMtime) { limitsMtime = m; draw(); }
  } catch (e) { /* no limits yet */ }
  let stat;
  try { stat = fs.statSync(INDEX); } catch (e) { return; }
  if (stat.mtimeMs === indexMtime) return;
  indexMtime = stat.mtimeMs;
  let entries;
  try { entries = JSON.parse(fs.readFileSync(INDEX, 'utf8').replace(/^﻿/, '')); } catch (e) { return; }
  for (const ws of myWorkspaces()) {
    const entry = entries[ws];
    if (!entry || !isLiveLog(entry.log) || entry.log === shownFile || !fs.existsSync(entry.log)) continue;
    // A running step, or one that finished moments ago, so a window opened for it still shows it.
    if (!ended(entry.log) || Date.now() - entry.started < FRESH_MS) follow(entry.log);
    return;
  }
}

function activate(context) {
  channel = vscode.window.createOutputChannel('TandemBridge');
  context.subscriptions.push(vscode.window.registerWebviewViewProvider(VIEW_ID, {
    resolveWebviewView(v) {
      view = v;
      v.webview.options = { enableScripts: true };
      v.webview.html = html(v.webview);
      v.onDidDispose(() => { view = null; });
      setTimeout(draw, 300);   // after the page's script is listening
    }
  }, { webviewOptions: { retainContextWhenHidden: true } }));
  const timer = setInterval(check, CHECK_MS);
  context.subscriptions.push(channel, { dispose: () => { clearInterval(timer); stopFollowing(); } });
  check();
  log(`active in ${myWorkspaces().join(', ') || 'a window with no folder'}`);
}

function deactivate() {
  stopFollowing();
}

module.exports = { activate, deactivate };
