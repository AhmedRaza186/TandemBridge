// `npm run bridge -- watch`: follows whatever step is running, in a terminal, like a chat.
// The orchestrator opens it in its own window when a step starts, unless one is already open.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { parseLog } = require('./live-parse');
const { indexFile, limitsFile } = require('./live');

const C = process.stdout.isTTY && !process.env.NO_COLOR
  ? { dim: '\x1b[2m', b: '\x1b[1m', red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', blue: '\x1b[34m', cyan: '\x1b[36m', orange: '\x1b[38;5;173m', x: '\x1b[0m' }
  : new Proxy({}, { get: () => '' });
const AGENT_COLOR = { 'Claude Code': C.orange, Antigravity: C.blue };
const SPIN = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

const readJson = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')); } catch (e) { return {}; } };
const fmtTokens = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n));
const fmtSecs = (s) => {
  s = Math.max(0, Math.round(s));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h ? `${h}h ${m}m` : m ? `${m}m ${String(r).padStart(2, '0')}s` : `${r}s`;
};
const time = (ms) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

function limitsText() {
  const c = readJson(limitsFile()).claude;
  if (!c) return '';
  const one = (name, w) => {
    if (!w) return '';
    const reset = w.resetsAt <= Date.now();
    const left = reset ? 100 : Math.round((1 - w.used) * 100);
    const color = left <= 10 ? C.red : left <= 30 ? C.yellow : C.green;
    return `${name} ${color}${left}% left${C.x}${C.dim}${reset ? '' : ` (resets ${time(w.resetsAt)})`}${C.x}`;
  };
  return ['Claude', one('5h', c.fiveHour), one('week', c.week)].filter(Boolean).join(' ');
}

// What to print for one item of the log.
function render(i, agent) {
  if (i.kind === 'agent') {
    const color = AGENT_COLOR[agent] || C.cyan;
    const body = i.text.split('\n').map((l) => `  ${l}`).join('\n');
    return `\n${color}${C.b}● ${agent || 'Agent'}${C.x}\n${body}\n`;
  }
  if (i.kind === 'tool') {
    const what = i.tool === 'write' ? `${C.cyan}${i.text}${C.x}` : i.text;
    return `  ${C.dim}${i.label.padEnd(9)}${C.x}${what}\n`;
  }
  if (i.kind === 'error') return `  ${C.red}${i.label}: ${i.text}${C.x}\n`;
  if (i.kind === 'done') {
    const ok = /^success/i.test(i.text);
    return `\n${ok ? C.green : C.red}${C.b}${ok ? '✓ Finished' : '✗ Stopped'}${C.x} ${C.dim}${i.text}${C.x}\n`;
  }
  return `  ${C.dim}${i.text}${C.x}\n`;
}

function watch({ workspace, out = process.stdout, pidFile } = {}) {
  if (pidFile) {
    try { fs.writeFileSync(pidFile, String(process.pid)); } catch (e) { /* only stops a second window */ }
    process.on('exit', () => { try { if (fs.readFileSync(pidFile, 'utf8') === String(process.pid)) fs.rmSync(pidFile); } catch (e) { /* gone */ } });
  }
  const want = workspace ? path.resolve(workspace).toLowerCase() : null;
  let file = null, offset = 0, text = '', shown = 0, log = null, frame = 0, status = '';
  const clear = () => { if (status) { out.write('\r\x1b[2K'); status = ''; } };
  const print = (s) => { clear(); out.write(s); };

  out.write(`${C.b}TandemBridge${C.x} ${C.dim}watching ${workspace || 'every project'}. Ctrl+C closes this window; the work carries on.${C.x}\n`);
  print(`${C.dim}Waiting for a step to start...${C.x}\n`);

  const pickLog = () => {
    const entries = Object.entries(readJson(indexFile())).filter(([k]) => !want || k === want);
    entries.sort((a, b) => b[1].started - a[1].started);
    return entries[0] && entries[0][1].log;
  };

  return setInterval(() => {
    const latest = pickLog();
    if (latest && latest !== file && fs.existsSync(latest)) {
      file = latest; offset = 0; text = ''; shown = 0; log = null;
    }
    if (file) {
      let size = 0;
      try { size = fs.statSync(file).size; } catch (e) { /* not yet */ }
      if (size > offset) {
        const fd = fs.openSync(file, 'r');
        const buf = Buffer.alloc(size - offset);
        fs.readSync(fd, buf, 0, buf.length, offset);
        fs.closeSync(fd);
        offset = size;
        text += buf.toString('utf8');
        const first = !log;
        log = parseLog(text);
        if (first) {
          const color = AGENT_COLOR[log.agent] || C.cyan;
          print(`\n${C.dim}${'─'.repeat(60)}${C.x}\n${C.b}${log.title}${C.x}  ${color}${log.agent || ''}${C.x}${C.dim}${log.model ? ` · ${log.model}` : ''}\n${log.folder}${C.x}\n`);
        }
        // An item is printed once it is complete: something came after it, or the run ended.
        const ready = log.ended ? log.items.length : Math.max(0, log.items.length - 1);
        for (; shown < ready; shown++) print(render(log.items[shown], log.agent));
        if (log.ended && shown === log.items.length) print(`${C.dim}Waiting for the next step...${C.x}\n`);
      }
    }
    // The line at the bottom: what is happening now, and how much of the plan is left.
    const parts = [];
    if (log && !log.ended) {
      parts.push(`${C.cyan}${SPIN[frame++ % SPIN.length]}${C.x} ${log.agent || 'Agent'} working`);
      if (log.started) parts.push(fmtSecs((Date.now() - log.started) / 1000));
      if (log.tokens) parts.push(`${fmtTokens(log.tokens)} tokens`);
    }
    const lim = limitsText();
    if (lim) parts.push(lim);
    const line = parts.join(`${C.dim} · ${C.x}`);
    if (line && out.isTTY) { out.write(`\r\x1b[2K${line}`); status = line; }
  }, 150);
}

// Opens `watch` in a new terminal window, unless one is already open.
function openWatchWindow(config) {
  if (!config.watchWindow || process.platform !== 'win32') return false;
  try {
    process.kill(Number(fs.readFileSync(config.watchPidFile, 'utf8')), 0);
    return false;                                   // already open
  } catch (e) { /* none open */ }
  const bin = path.join(__dirname, '..', '..', 'bin', 'tandembridge.js');
  const child = spawn('cmd.exe', ['/d', '/c', 'start', '"TandemBridge"', 'cmd.exe', '/k',
    `""${process.execPath}" "${bin}" watch"`], { detached: true, stdio: 'ignore', windowsVerbatimArguments: true });
  child.on('error', () => {});
  child.unref();
  return true;
}

module.exports = { watch, openWatchWindow, render, limitsText };
