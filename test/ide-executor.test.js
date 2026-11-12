const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createAntigravityExecutor } = require('../src/agents/executors');
const { describe: describeTool } = require('../src/agents/live');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-live-'));
const LIVE = path.join(TMP, 'live');
process.env.TANDEMBRIDGE_LIVE_INDEX = path.join(TMP, 'live.json');
const index = () => JSON.parse(fs.readFileSync(process.env.TANDEMBRIDGE_LIVE_INDEX, 'utf8'));

const events = (conv) => [
  { event: 'init', conversation_id: conv },
  { event: 'step_update', step_update: { conversation_id: conv, step_type: 'agent_response', state: 'ACTIVE', text_delta: 'Building ' } },
  { event: 'step_update', step_update: { conversation_id: conv, step_type: 'agent_response', state: 'DONE', text_delta: 'the UI' } },
  { event: 'step_update', step_update: { conversation_id: conv, step_type: 'tool', state: 'ERROR', tool_name: 'run_command' } },
  { event: 'result', result: { conversation_id: conv, status: 'SUCCESS', response: 'Finished\n' } }
].map((e) => JSON.stringify(e));

function setup(lines, code = 0) {
  const ide = [], logs = [], calls = [];
  const exec = (bin, args, opts) => {
    calls.push({ bin, args, opts });
    lines.forEach((l) => opts.onLine(l));
    return { kill() {}, done: Promise.resolve({ code, out: lines.join('\n'), err: '', ms: 1 }) };
  };
  const config = { agyBin: 'agy', agyModel: 'm', agyTimeoutMs: 1000, extensionId: 'ext', antigravityCli: 'none', liveDir: LIVE };
  const ex = createAntigravityExecutor(config, { exec, ide: (a) => ide.push(a), log: (l) => logs.push(l) });
  return { ex, ide, logs, calls };
}

const ws = path.resolve('some project');

test('opens the project window once, and lists its live log for that window to find', async () => {
  const { ex, ide } = setup(events('c-1'));
  const res = await ex.start('work', ws, { scope: ['frontend/'] }).done;
  assert.deepStrictEqual(ide, [['--new-window', ws]]);
  assert.strictEqual(index()[ws.toLowerCase()].log, path.join(LIVE, 'c-1.log'));
  assert.strictEqual(res.ok, true);
  assert.match(res.summary, /Finished/);
});

test('the live log shows the work as it happens', async () => {
  const lines = [
    { event: 'init', conversation_id: 'c-live' },
    { event: 'step_update', step_update: { step_index: 1, step_type: 'tool', state: 'ACTIVE', tool_name: 'write_file', tool_info: { parameters: { Path: path.join(ws, 'frontend', 'App.tsx') } } } },
    { event: 'step_update', step_update: { step_index: 1, step_type: 'tool', state: 'DONE', tool_name: 'write_file', tool_info: { parameters: { Path: path.join(ws, 'frontend', 'App.tsx') } } } },
    { event: 'step_update', step_update: { step_index: 2, step_type: 'tool', state: 'ACTIVE', tool_name: 'run_command', tool_info: { parameters: { CommandLine: 'npm --prefix frontend test' } } } },
    { event: 'step_update', step_update: { step_index: 3, step_type: 'agent_response', state: 'ACTIVE', text_delta: 'Built ' } },
    { event: 'step_update', step_update: { step_index: 3, step_type: 'agent_response', state: 'DONE', text_delta: 'the page.' } },
    { event: 'result', result: { status: 'SUCCESS', response: 'Built the page.', duration_seconds: 42, usage: { total_tokens: 1234 } } }
  ].map((e) => JSON.stringify(e));
  const { ex } = setup(lines);
  await ex.start('work', ws, { scope: ['frontend/'], title: 'Build the home page' }).done;
  const file = index()[ws.toLowerCase()].log;
  assert.strictEqual(file, path.join(LIVE, 'c-live.log'));
  const text = fs.readFileSync(file, 'utf8');
  assert.match(text, /TandemBridge step: Build the home page/);
  assert.match(text, /> write_file {2}frontend\/App\.tsx\n/);
  assert.strictEqual(text.match(/write_file/g).length, 1, 'each tool call is shown once');
  assert.match(text, /> run_command {2}npm --prefix frontend test/);
  assert.match(text, /Agent: Built the page\./);
  assert.match(text, /Finished: SUCCESS, 42s, 1234 tokens/);
  assert.match(text, /\[end\]\n$/);
});

test('a failed run still ends the live log, with the reason', async () => {
  const lines = [JSON.stringify({ event: 'init', conversation_id: 'c-fail' })];
  const { ex } = setup(lines, 1);
  await ex.start('work', ws, { scope: [] }).done;
  assert.match(fs.readFileSync(path.join(LIVE, 'c-fail.log'), 'utf8'), /Stopped: .*\n\[end\]\n$/);
});

test('tool details: paths inside the project are shown relative, commands in full', () => {
  assert.strictEqual(describeTool({ parameters: { Path: path.join(ws, 'a', 'b.ts') } }, ws), 'a/b.ts');
  assert.strictEqual(describeTool({ parameters: { CommandLine: 'npm   test' } }, ws), 'npm test');
  assert.strictEqual(describeTool({}, ws), '');
});

test('live progress reaches the terminal log', async () => {
  const { ex, logs } = setup(events('c-2'));
  await ex.start('work', ws, { scope: [] }).done;
  assert.ok(logs.some((l) => l === 'antigravity: Building the UI'));
  assert.ok(logs.some((l) => /tool error: run_command/.test(l)));
});

test('permissions stay narrow, and the prompt never goes through a shell', async () => {
  const { ex, calls } = setup(events('c-3'));
  await ex.start('work', ws, { scope: ['frontend/'] }).done;
  const { args, opts } = calls[0];
  assert.strictEqual(opts.direct, true);
  assert.ok(!args.includes('--dangerously-skip-permissions'));
  assert.strictEqual(args[args.indexOf('--mode') + 1], 'accept-edits');
  const allow = JSON.parse(args[args.indexOf('--settings') + 1]).permissions.allow;
  assert.ok(allow.includes('command(cd frontend && npm install)'));
  assert.ok(!allow.includes('command(*)'));
});

test('the prompt lists commands one per line, so they are not run as one joined command', async () => {
  const { ex, calls } = setup(events('c-4'));
  await ex.start('work', ws, { scope: ['frontend/'] }).done;
  const prompt = calls[0].args[1];
  assert.match(prompt, /\n- npm --prefix frontend test(\n|$)/);
  assert.ok(!prompt.includes(' ; '));
});

test('a retry is told which command was blocked', async () => {
  const lines = [JSON.stringify({ event: 'init', conversation_id: 'c' }),
    JSON.stringify({ event: 'step_update', step_update: { step_type: 'tool', state: 'ERROR', tool_name: 'run_command',
      tool_info: { error: { message: 'permission check failed for unsandboxed "Get-ChildItem x": user denied' } } } }),
    JSON.stringify({ event: 'result', result: { status: 'SUCCESS', response: '', denied_actions: [{ action: 'command', display_name: 'RunCommand' }] } })];
  const { ex } = setup(lines);
  const res = await ex.start('work', ws, { scope: [] }).done;
  assert.strictEqual(res.ok, false);
  assert.match(res.error, /not allowed, do not run it again: .*Get-ChildItem x/);
});

test('a stream with denied tools and no reply is a failure', async () => {
  const lines = [JSON.stringify({ event: 'init', conversation_id: 'c' }),
    JSON.stringify({ event: 'result', result: { status: 'SUCCESS', response: '', denied_actions: [{ action: 'command', display_name: 'RunCommand' }] } })];
  const { ex } = setup(lines);
  const res = await ex.start('work', ws, { scope: [] }).done;
  assert.strictEqual(res.ok, false);
  assert.match(res.error, /permission denied for: RunCommand/);
});

test('a quota failure mid-stream is recognised', async () => {
  const res = await (() => {
    const exec = (b, a, o) => ({ kill() {}, done: Promise.resolve({ code: 1, out: JSON.stringify({ event: 'init', conversation_id: 'c' }), err: 'RESOURCE_EXHAUSTED: quota', ms: 1 }) });
    const ex = createAntigravityExecutor({ agyBin: 'a', agyModel: 'm', agyTimeoutMs: 1 }, { exec, ide() {} });
    return ex.start('w', ws, { scope: [] }).done;
  })();
  assert.strictEqual(res.failure, 'quota');
});
