const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { LEVELS, usageLevel, claudeChoice } = require('../src/config/usage');
const { createClaudeExecutor } = require('../src/agents/executors');
const { buildPrompt } = require('../src/core/engine');

test('the levels spend more only where it pays, and an unknown level is refused', () => {
  assert.strictEqual(usageLevel(undefined), LEVELS.balanced);
  assert.throws(() => usageLevel('unlimited'), /limits\.usage must be one of saver, balanced, max/);
  assert.ok(LEVELS.saver.workflowBudgetUsd < LEVELS.balanced.workflowBudgetUsd);
  assert.ok(LEVELS.balanced.workflowBudgetUsd < LEVELS.max.workflowBudgetUsd);
});

test('every kind of step runs on Opus 5.5 at medium effort, and .env can force another', () => {
  const config = { usage: LEVELS.balanced };
  for (const kind of ['implement', 'review', 'test', 'document']) {
    assert.deepStrictEqual(claudeChoice(config, kind), { model: 'claude-opus-5-5', effort: 'medium' });
  }
  assert.deepStrictEqual(claudeChoice({ ...config, claudeModel: 'opus', claudeEffort: 'low' }, 'implement'), { model: 'opus', effort: 'low' });
});

// A stand-in claude that records the arguments it was given.
function fakeClaude() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-fake-claude-'));
  const out = path.join(dir, 'args.json');
  fs.writeFileSync(path.join(dir, 'rec.js'),
    `require('fs').writeFileSync(${JSON.stringify(out)}, JSON.stringify(process.argv.slice(2))); console.log('{"result":"ok"}');`);
  const bin = process.platform === 'win32' ? path.join(dir, 'claude.cmd') : path.join(dir, 'claude');
  fs.writeFileSync(bin, process.platform === 'win32'
    ? `@"${process.execPath}" "%~dp0rec.js" %*\r\n`
    : `#!/bin/sh\nexec "${process.execPath}" "$(dirname "$0")/rec.js" "$@"\n`, { mode: 0o755 });
  return { bin, args: () => JSON.parse(fs.readFileSync(out, 'utf8')) };
}

test('claude is started with the model, effort, budget, and the read limits', async () => {
  const fake = fakeClaude();
  const config = {
    usage: LEVELS.saver, claudeBin: fake.bin, taskBudgetUsd: '2', claudeTimeoutMs: 20000,
    claudeAllowedTools: ['Bash(npm *)'], claudeDeniedTools: ['Read(**/node_modules/**)']
  };
  await createClaudeExecutor(config).start('p', process.cwd(), { scope: [] }, { kind: 'review' }).done;
  const line = fake.args().join(' ');
  assert.match(line, /--model claude-opus-5-5/);
  assert.match(line, /--effort medium/);
  assert.match(line, /--max-budget-usd 2/);
  assert.match(line, /Read\(\*\*\/node_modules\/\*\*\)/);
});

test('every prompt asks the agent to spend tokens carefully', () => {
  const wf = { title: 't', goal: 'g', workspace: process.cwd(), spec_json: '{}' };
  const prompt = buildPrompt({ id: 1, seq: 1, kind: 'implement', assignee: 'claude' },
    { title: 't', goal: 'g', scope: ['b/'], acceptance: [], verify: [] }, wf, []);
  assert.match(prompt, /Use tokens carefully/);
  assert.match(prompt, /never read node_modules/);
});
