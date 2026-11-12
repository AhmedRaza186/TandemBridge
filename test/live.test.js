// The Claude live log and the saved plan limits.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-live-claude-'));
process.env.TANDEMBRIDGE_LIMITS_FILE = path.join(TMP, 'limits.json');

const { createLiveLog, claudeReader, saveClaudeLimits } = require('../src/agents/live');
const { parseLog } = require('../src/agents/live-parse');

const LIVE = path.join(TMP, 'live');

test('a Claude run becomes a live log with its tools, tokens, and result', () => {
  const ws = path.join(TMP, 'p2');
  const live = createLiveLog(LIVE, 'claude-1', { title: 'Backend', workspace: ws, agent: 'Claude Code', model: 'm' });
  const read = claudeReader(live, ws);
  const usage = { input_tokens: 10, cache_read_input_tokens: 100, cache_creation_input_tokens: 0, output_tokens: 5 };
  read({ type: 'assistant', message: { id: 'a', usage, content: [{ type: 'text', text: 'Reading the contract.' }] } });
  read({ type: 'assistant', message: { id: 'a', usage, content: [{ type: 'tool_use', name: 'Read', input: { file_path: path.join(ws, 'docs', 'API.md') } }] } });
  read({ type: 'user', message: { content: [{ type: 'tool_result', is_error: true, content: 'File not found' }] } });
  read({ type: 'assistant', message: { id: 'b', usage, content: [{ type: 'tool_use', name: 'Bash', input: { command: 'npm test' } }] } });
  read({ type: 'result', is_error: false, duration_ms: 12000, total_cost_usd: 0.25 });
  live.end('');
  const r = parseLog(fs.readFileSync(live.file, 'utf8'));
  assert.strictEqual(r.agent, 'Claude Code');
  assert.ok(r.started);
  assert.deepStrictEqual(r.items.slice(0, 4), [
    { kind: 'agent', text: 'Reading the contract.' },
    { kind: 'tool', label: 'Read', tool: 'read', text: 'docs/API.md' },
    { kind: 'error', label: 'tool failed', text: 'File not found' },
    { kind: 'tool', label: 'Ran', tool: 'run', text: 'npm test' }
  ]);
  assert.strictEqual(r.tokens, 230, 'each message is counted once');
  assert.match(r.items[4].text, /success, 12s, 230 tokens, \$0\.25/);
  assert.strictEqual(r.ended, true);
});

test('Claude\'s plan limits are kept as fractions with their reset times', () => {
  saveClaudeLimits({ unifiedWindows: { five_hour: { utilization: 0.77, resetsAt: 1794480000, status: 'allowed' }, seven_day: { utilization: 16, resetsAt: 1795003200 } } }, 42);
  const all = JSON.parse(fs.readFileSync(process.env.TANDEMBRIDGE_LIMITS_FILE, 'utf8'));
  assert.deepStrictEqual(all.claude.fiveHour, { used: 0.77, resetsAt: 1794480000000, status: 'allowed' });
  assert.strictEqual(all.claude.week.used, 0.16);
  assert.strictEqual(all.claude.updated, 42);
});

test('watch prints each step like a chat, once each item is complete', async () => {
  const { watch } = require('../src/agents/watch');
  process.env.TANDEMBRIDGE_LIVE_INDEX = path.join(TMP, 'watch-index.json');
  const ws = path.join(TMP, 'p3');
  const live = createLiveLog(LIVE, 'watch-1', { title: 'Login page', workspace: ws, agent: 'Antigravity', model: 'm' });
  fs.writeFileSync(process.env.TANDEMBRIDGE_LIVE_INDEX, JSON.stringify({ [ws.toLowerCase()]: { log: live.file, started: Date.now() } }));
  let text = '';
  const out = { isTTY: false, write: (s) => { text += s; } };
  const timer = watch({ out });
  try {
    live.say('Building the form.'); live.endSay();
    live.tool('write_file', 'src/Login.tsx');
    await new Promise((r) => setTimeout(r, 400));
    assert.match(text, /Login page/);
    assert.match(text, /● Antigravity\n {2}Building the form\./);
    assert.doesNotMatch(text, /Login\.tsx/, 'the last item waits until it is complete');
    live.finish({ status: 'success', seconds: 9 });
    live.end('');
    await new Promise((r) => setTimeout(r, 400));
    assert.match(text, /Wrote {4}src\/Login\.tsx/);
    assert.match(text, /✓ Finished success, 9s/);
    assert.match(text, /Waiting for the next step/);
  } finally { clearInterval(timer); }
});
