// Runs the Antigravity extension against a stand-in for the vscode module.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

function loadExtension(home, folders) {
  const shown = { text: '', cleared: 0, opened: 0, posted: [], focused: 0 };
  const vscode = {
    workspace: { workspaceFolders: folders.map((f) => ({ uri: { fsPath: f } })) },
    commands: { executeCommand: () => { shown.focused++; return Promise.resolve(); } },
    window: {
      registerWebviewViewProvider: (id, provider) => { shown.provider = provider; return { dispose() {} }; },
      createOutputChannel: () => ({
        append: (t) => { shown.text += t; }, clear: () => { shown.cleared++; shown.text = ''; },
        show: () => { shown.opened++; }, dispose() {}
      })
    }
  };
  const realLoad = Module._load;
  const realHome = os.homedir;
  Module._load = function (request, ...rest) { return request === 'vscode' ? vscode : realLoad.call(this, request, ...rest); };
  os.homedir = () => home;
  const file = require.resolve('../extensions/antigravity/extension.js');
  delete require.cache[file];
  try {
    const ext = require(file);
    const context = { subscriptions: [] };
    ext.activate(context);
    return { shown, stop: () => context.subscriptions.forEach((s) => s.dispose && s.dispose()) };
  } finally {
    Module._load = realLoad;
    os.homedir = realHome;
  }
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function writeIndex(home, entries) {
  fs.mkdirSync(path.join(home, '.tandembridge'), { recursive: true });
  fs.writeFileSync(path.join(home, '.tandembridge', 'live.json'), JSON.stringify(entries));
}

test('the window for the project follows its live log until it ends', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-ext-'));
  const ws = path.join(home, 'project');
  const log = path.join(home, 'live', 'abc-1.log');
  fs.mkdirSync(path.dirname(log), { recursive: true });
  fs.writeFileSync(log, 'TandemBridge step: x\n');
  writeIndex(home, { [ws.toLowerCase()]: { log, started: Date.now() } });

  const ext = loadExtension(home, [ws]);
  try {
    await wait(1300);
    assert.strictEqual(ext.shown.focused, 1);
    assert.match(ext.shown.text, /TandemBridge step: x/);
    fs.appendFileSync(log, '> write_file  a.ts\n[end]\n');
    await wait(800);
    assert.match(ext.shown.text, /write_file {2}a\.ts\n\[end\]/);
  } finally { ext.stop(); }
});

test('another project\'s log is never shown, and a link to any other file is refused', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-ext-'));
  const mine = path.join(home, 'mine');
  const secret = path.join(home, 'secret.txt');
  fs.writeFileSync(secret, 'do not show');
  writeIndex(home, { [path.join(home, 'other').toLowerCase()]: { log: secret, started: Date.now() }, [mine.toLowerCase()]: { log: secret, started: Date.now() } });
  const ext = loadExtension(home, [mine]);
  try {
    await wait(1300);
    assert.strictEqual(ext.shown.opened + ext.shown.focused, 0);
    assert.strictEqual(ext.shown.text, '');
  } finally { ext.stop(); }
});

test('the side panel gets the step as a conversation', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-ext-'));
  const ws = path.join(home, 'project');
  const log = path.join(home, 'live', 'abc-2.log');
  fs.mkdirSync(path.dirname(log), { recursive: true });
  fs.writeFileSync(log, `TandemBridge step: Login page\nFolder: ${ws}\n${'-'.repeat(60)}\n`);
  writeIndex(home, { [ws.toLowerCase()]: { log, started: Date.now() } });
  const ext = loadExtension(home, [ws]);
  const posted = [];
  const view = { show() {}, onDidDispose() {}, webview: { options: {}, html: '', postMessage: (m) => posted.push(m) } };
  ext.shown.provider.resolveWebviewView(view);
  try {
    assert.match(view.webview.html, /Content-Security-Policy/);
    await wait(1300);
    fs.appendFileSync(log, 'Agent: Starting.\n\n> write_file  src/a.ts\n[end]\n');
    await wait(800);
    const last = posted[posted.length - 1];
    assert.strictEqual(last.title, 'Login page');
    assert.deepStrictEqual(last.items.map((i) => i.kind), ['agent', 'tool']);
    assert.strictEqual(last.ended, true);
  } finally { ext.stop(); }
});

test('parseLog keeps a long agent message together and labels tools', () => {
  const { parseLog } = require('../src/agents/live-parse');
  const r = parseLog('TandemBridge step: X\nFolder: D:\p\n' + '-'.repeat(60) + '\nAgent: one\ntwo\n\nthree\n> run_command  npm test\nx view_file failed: missing\n' + '-'.repeat(60) + '\nFinished: success, 12s\nWorker stopped\n[end]\n');
  assert.deepStrictEqual(r.items, [
    { kind: 'agent', text: 'one\ntwo\n\nthree' },
    { kind: 'tool', label: 'Ran', tool: 'run', text: 'npm test' },
    { kind: 'error', label: 'Read failed', text: 'missing' },
    { kind: 'done', text: 'success, 12s' },
    { kind: 'note', text: 'Worker stopped' }
  ]);
  assert.strictEqual(r.folder, 'D:\p');
  assert.strictEqual(r.ended, true);
});
