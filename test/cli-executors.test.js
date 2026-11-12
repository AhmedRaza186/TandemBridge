const test = require('node:test');
const assert = require('node:assert');
const {
  createCodexExecutor, createCopilotExecutor, createGeminiExecutor,
  parseCodexRun, parseCopilotRun, parseGeminiRun, copilotArgs, geminiArgs
} = require('../src/agents/cli-executors');
const { AGENT_IDS, createExecutors } = require('../src/agents/registry');

const config = {
  codexBin: 'codex', copilotBin: 'copilot', geminiBin: 'gemini', workerTimeoutMs: 1000,
  shellAllow: ['npm test', 'git status'], shellDeny: ['git push'],
  claudeAllowedTools: [], claudeDeniedTools: []
};
const run = (out, code = 0, err = '') => ({ code, out, err, timedOut: false, ms: 5 });

// Records what the executor would run, without running anything.
function fakeExec(result) {
  const calls = [];
  const exec = (bin, args, opts) => { calls.push({ bin, args, opts }); return { kill() {}, done: Promise.resolve(result) }; };
  return { calls, exec };
}

test('every agent in the registry gets an executor', () => {
  const ex = createExecutors(config, { log() {} });
  assert.deepStrictEqual(Object.keys(ex), AGENT_IDS);
  for (const id of AGENT_IDS) assert.strictEqual(typeof ex[id].start, 'function');
});

test('prompts go over stdin, never as an argument', async () => {
  const prompt = 'TandemBridge task 1 & "quoted" %PATH%';
  for (const create of [createCodexExecutor, createCopilotExecutor, createGeminiExecutor]) {
    const f = fakeExec(run(''));
    await create(config, { exec: f.exec }).start(prompt, 'D:/ws').done;
    assert.strictEqual(f.calls[0].opts.input, prompt);
    assert.strictEqual(f.calls[0].opts.cwd, 'D:/ws');
    assert.ok(!f.calls[0].args.some((a) => a.includes('TandemBridge task')));
  }
});

test('codex works in its own workspace-write sandbox', async () => {
  const f = fakeExec(run(''));
  await createCodexExecutor(config, { exec: f.exec }).start('p', 'D:/ws').done;
  const a = f.calls[0].args;
  assert.strictEqual(a[0], 'exec');
  assert.strictEqual(a[a.indexOf('--sandbox') + 1], 'workspace-write');
  assert.strictEqual(a[a.indexOf('-C') + 1], 'D:/ws');
});

test('codex moves to the next model when the account cannot use one, and stops on real errors', async () => {
  const seen = [];
  const exec = (bin, args) => {
    const model = args[args.indexOf('-m') + 1];
    seen.push(model);
    const out = model === 'sol'
      ? `{"type":"thread.started","thread_id":"a"}\n{"type":"error","message":"The 'sol' model is not supported when using Codex with a ChatGPT account."}`
      : '{"type":"turn.completed"}';
    return { kill() {}, done: Promise.resolve(run(out, model === 'sol' ? 1 : 0)) };
  };
  const r = await createCodexExecutor({ ...config, plannerModels: ['sol', 'luna'] }, { exec }).start('p', 'w').done;
  assert.deepStrictEqual(seen, ['sol', 'luna']);
  assert.strictEqual(r.ok, true);

  seen.length = 0;
  const quota = (bin, args) => { seen.push(args[args.indexOf('-m') + 1]); return { kill() {}, done: Promise.resolve(run('{"type":"error","message":"usage limit reached"}', 1)) }; };
  const q = await createCodexExecutor({ ...config, plannerModels: ['sol', 'luna'] }, { exec: quota }).start('p', 'w').done;
  assert.deepStrictEqual(seen, ['sol'], 'a quota error is not a reason to try another model');
  assert.strictEqual(q.failure, 'quota');
});

test('codex output: a completed turn is success, a failed turn is not', () => {
  const ok = parseCodexRun(run([
    '{"type":"thread.started","thread_id":"t1"}',
    '{"type":"item.completed","item":{"type":"agent_message","text":"Built the API."}}',
    '{"type":"turn.completed","usage":{}}'
  ].join('\n')));
  assert.strictEqual(ok.ok, true);
  assert.strictEqual(ok.summary, 'Built the API.');
  assert.strictEqual(ok.session_id, 't1');

  const bad = parseCodexRun(run('{"type":"turn.failed","error":{"message":"You hit your usage limit"}}', 1));
  assert.strictEqual(bad.ok, false);
  assert.strictEqual(bad.failure, 'quota');
  assert.strictEqual(parseCodexRun(run('', 0)).ok, false, 'no completed turn means nothing was done');
});

test('copilot may write files and run only the listed commands, and the deny list is passed', () => {
  const a = copilotArgs(config);
  assert.ok(a.includes('--no-ask-user'));
  assert.deepStrictEqual(a.filter((x, i) => a[i - 1] === '--allow-tool'), ['write', 'shell(npm test:*)', 'shell(git status:*)']);
  assert.deepStrictEqual(a.filter((x, i) => a[i - 1] === '--deny-tool'), ['shell(git push:*)']);
  assert.ok(!a.some((x) => /allow-all/.test(x)));
});

test('copilot output: text with exit 0 is success, an empty answer is not', () => {
  assert.strictEqual(parseCopilotRun(run('Done. Added the routes.')).ok, true);
  assert.strictEqual(parseCopilotRun(run('')).ok, false);
  const r = parseCopilotRun(run('', 1, 'Error: not logged in'));
  assert.strictEqual(r.failure, 'auth');
});

test('gemini edits files, runs only the listed command prefixes, and never yolo', () => {
  const a = geminiArgs(config);
  assert.strictEqual(a[a.indexOf('--approval-mode') + 1], 'auto_edit');
  assert.deepStrictEqual(a.filter((x, i) => a[i - 1] === '--allowed-tools'), ['run_shell_command(npm test)', 'run_shell_command(git status)']);
  assert.ok(!a.includes('--yolo') && !a.includes('yolo'));
});

test('gemini output: the JSON response is the summary, and an error object is a failure', () => {
  const ok = parseGeminiRun(run('Loaded cached credentials.\n{"response":"Frontend done.","stats":{}}'));
  assert.strictEqual(ok.ok, true);
  assert.strictEqual(ok.summary, 'Frontend done.');
  const bad = parseGeminiRun(run('{"response":"","error":{"message":"Quota exceeded for requests"}}', 1));
  assert.strictEqual(bad.ok, false);
  assert.strictEqual(bad.failure, 'quota');
  assert.match(parseGeminiRun(run('', 53)).error, /turn limit/);
});
