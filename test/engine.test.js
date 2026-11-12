const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { createRig, step } = require('./helpers');
const { git } = require('../src/core/gitops');
const { answerTask, resumeWorkflow, retryWorkflow, cancelWorkflow, validateSpec } = require('../src/core/workflow');
const { toSql } = require('../src/db/connection');

const withRig = (name, opts, fn) => test(name, async () => {
  const rig = await createRig(opts).setup();
  try { await fn(rig); } finally { await rig.close(); }
});

const statuses = async (rig, wf) => (await rig.tasks(wf)).map((t) => t.status);
const writes = (rel, summary) => (c) => { c.write(rel); c.report({ status: 'done', summary: summary || `wrote ${rel}` }); };

withRig('full run: steps in order, context handed on, each step committed, final report sent', {
  script: {
    1: [writes('docs/API_CONTRACT.md', 'contract ready')],
    2: [writes('backend/server.js', 'backend ready')],
    3: [writes('frontend/app.js', 'frontend ready')],
    4: [(c) => c.report({ status: 'done', summary: 'all good' })]
  }
}, async (rig) => {
  const { id, branch } = await rig.create([
    step(1, 'claude', ['docs/API_CONTRACT.md']),
    step(2, 'claude', ['backend/']),
    step(3, 'antigravity', ['frontend/']),
    step(4, 'claude', [], { kind: 'review' })
  ], { run_instructions: 'npm start' });
  await rig.drive();

  assert.strictEqual((await rig.workflow(id)).status, 'done');
  assert.deepStrictEqual(rig.prompts.map((p) => p.seq), [1, 2, 3, 4]);
  const third = rig.prompts.find((p) => p.seq === 3).prompt;
  assert.match(third, /contract ready/);
  assert.match(third, /backend ready/);
  assert.match(rig.prompts.find((p) => p.seq === 4).prompt, /changes_requested/);

  assert.strictEqual((await git(rig.workspace, ['branch', '--show-current'])).trim(), branch);
  const logText = await git(rig.workspace, ['log', '--oneline']);
  assert.strictEqual(logText.trim().split('\n').length, 5);      // start + backend guide + 3 steps that changed files

  const final = rig.sent.find((m) => /Work complete/.test(m.subject));
  assert.ok(final, 'final report emailed');
  assert.match(final.body, /npm start/);
  assert.match(final.body, /backend ready/);
});

withRig('a failed step stops later steps and alerts', {
  script: { 1: [(c) => { c.write('frontend/stolen.js'); c.report({ status: 'done', summary: 'oops' }); }] }
}, async (rig) => {
  const { id } = await rig.create([step(1, 'claude', ['backend/']), step(2, 'antigravity', ['frontend/'])]);
  await rig.drive();
  assert.deepStrictEqual(await statuses(rig, id), ['failed', 'pending']);
  assert.strictEqual((await rig.workflow(id)).status, 'failed');
  assert.strictEqual(rig.prompts.length, 1);
  const t = (await rig.tasks(id))[0];
  assert.match(JSON.parse(t.result_json).error, /outside its scope: frontend\/stolen\.js/);
  assert.ok(rig.sent.some((m) => /fail/.test(m.subject)));
});

withRig('an empty stray root lockfile does not fail a step, but one with content does', {
  script: {
    1: [(c) => { c.write('package-lock.json', '{"name":"x","lockfileVersion":3,"packages":{}}'); c.write('f/a.js'); c.report({ status: 'done', summary: 'x' }); }],
    2: [(c) => { c.write('package-lock.json', '{"packages":{"":{"name":"x"}}}'); c.write('g/a.js'); c.report({ status: 'done', summary: 'y' }); }]
  }
}, async (rig) => {
  const { id } = await rig.create([step(1, 'antigravity', ['f/']), step(2, 'antigravity', ['g/'])]);
  await rig.drive();
  const [one, two] = await rig.tasks(id);
  assert.strictEqual(one.status, 'done');
  assert.strictEqual(two.status, 'failed');
  assert.match(JSON.parse(two.result_json).error, /package-lock\.json/);
});

withRig('retry runs only the failed step again, keeps its files, and reports again at the end', {
  script: { 1: [writes('b/a.js')], 2: [(c) => { c.write('elsewhere/x.js'); c.report({ status: 'done', summary: 'oops' }); },
    (c) => { fs.rmSync(path.join(c.workspace, 'elsewhere'), { recursive: true }); c.write('f/a.js'); c.report({ status: 'done', summary: 'fixed' }); }] }
}, async (rig) => {
  const { id } = await rig.create([step(1, 'claude', ['b/']), step(2, 'antigravity', ['f/'])]);
  await rig.drive();
  assert.strictEqual((await rig.workflow(id)).status, 'failed');
  await retryWorkflow(rig.db, id, 'Remove the file outside your folder.');
  await rig.drive();
  assert.strictEqual((await rig.workflow(id)).status, 'done');
  assert.strictEqual(rig.prompts.filter((p) => p.seq === 1).length, 1, 'finished step not repeated');
  assert.match(rig.prompts[rig.prompts.length - 1].prompt, /Remove the file outside your folder/);
  assert.ok(rig.sent.some((m) => /Work complete/.test(m.subject)));
  assert.ok(rig.sent.some((m) => /fail/.test(m.subject)));
  await assert.rejects(retryWorkflow(rig.db, id), /not failed/);
});

withRig('folder ownership: a rename out of scope is caught', {
  script: {
    1: [writes('shared/a.js')],
    2: [(c) => { fs.mkdirSync(path.join(c.workspace, 'frontend'), { recursive: true }); fs.renameSync(path.join(c.workspace, 'shared/a.js'), path.join(c.workspace, 'frontend/a.js')); c.report({ status: 'done', summary: 'moved' }); }]
  }
}, async (rig) => {
  const { id } = await rig.create([step(1, 'claude', ['shared/']), step(2, 'antigravity', ['frontend/'])]);
  await rig.drive();
  assert.strictEqual((await rig.tasks(id))[1].status, 'failed');
});

withRig('verify failure retries with feedback, then succeeds', {
  script: { 1: [(c) => { c.write('b/x.js'); c.report({ status: 'done', summary: 'first' }); }, (c) => { c.write('b/ok.txt'); c.report({ status: 'done', summary: 'second' }); }] }
}, async (rig) => {
  const check = `node -e "process.exit(require('fs').existsSync('b/ok.txt')?0:1)"`;
  const { id } = await rig.create([step(1, 'claude', ['b/'], { verify: [check] })]);
  await rig.drive();
  assert.strictEqual((await rig.workflow(id)).status, 'done');
  assert.strictEqual(rig.prompts.length, 2);
  assert.match(rig.prompts[1].prompt, /previous attempt failed/);
});

withRig('a check that fails with no output still tells the agent what happened', {
  script: { 1: [writes('b/x.js'), writes('b/y.js')] }
}, async (rig) => {
  const check = `node -e "process.exit(require('fs').existsSync('b/y.js')?0:7)"`;
  await rig.create([step(1, 'claude', ['b/'], { verify: [check] })]);
  await rig.drive();
  assert.match(rig.prompts[1].prompt, /check .* failed:\n\(no output\) exit code 7/);
});

withRig('verify keeps failing: step fails after the retry limit', {
  script: { 1: [writes('b/x.js')] }
}, async (rig) => {
  const { id } = await rig.create([step(1, 'antigravity', ['b/'], { verify: ['node -e "process.exit(1)"'] })]);
  await rig.drive();
  assert.strictEqual((await rig.tasks(id))[0].status, 'failed');
  assert.strictEqual(rig.prompts.length, 3);                     // first run + 2 retries
});

withRig('agents talk: a question goes to the other agent and the answer comes back', {
  script: {
    1: [(c) => c.report({ status: 'blocked', question: 'What is the auth header?', ask: 'claude' }),
        (c) => { c.write('frontend/app.js'); c.report({ status: 'done', summary: 'used the header' }); }],
    2: [(c) => c.report({ status: 'done', summary: 'Use Authorization: Bearer' })]
  }
}, async (rig) => {
  const { id } = await rig.create([step(1, 'antigravity', ['frontend/'])]);
  await rig.drive();
  assert.strictEqual((await rig.workflow(id)).status, 'done');
  assert.match(rig.prompts[1].prompt, /What is the auth header/);
  assert.match(rig.prompts[2].prompt, /claude says: Use Authorization: Bearer/);
  assert.strictEqual(rig.sent.filter((m) => /Your answer needed/.test(m.subject)).length, 0);
});

withRig('question for the owner: email, wait, then continue after the answer', {
  script: {
    1: [(c) => c.report({ status: 'blocked', question: 'PKR or USD?', ask: 'user' }),
        (c) => { c.write('b/a.js'); c.report({ status: 'done', summary: 'used PKR' }); }]
  }
}, async (rig) => {
  const { id } = await rig.create([step(1, 'claude', ['b/'])]);
  await rig.drive();
  assert.strictEqual((await rig.workflow(id)).status, 'blocked');
  const mail = rig.sent.find((m) => /Your answer needed/.test(m.subject));
  assert.match(mail.body, /PKR or USD/);
  assert.strictEqual(rig.prompts.length, 1);

  const [t] = await rig.tasks(id);
  await answerTask(rig.db, t.id, 'PKR');
  await rig.drive();
  assert.strictEqual((await rig.workflow(id)).status, 'done');
  assert.match(rig.prompts[1].prompt, /The answer is: PKR/);
});

withRig('review sends fixes back, then re-reviews and passes', {
  script: {
    1: [writes('backend/a.js')],
    2: [(c) => c.report({ status: 'changes_requested', summary: 'bug in backend', fixes: [{ assignee: 'claude', goal: 'fix the bug', scope: ['backend/'] }] })],
    3: [writes('backend/fix.js', 'fixed')],
    4: [(c) => c.report({ status: 'done', summary: 'clean now' })]
  }
}, async (rig) => {
  const { id } = await rig.create([step(1, 'claude', ['backend/']), step(2, 'claude', [], { kind: 'review' })]);
  await rig.drive();
  assert.strictEqual((await rig.workflow(id)).status, 'done');
  const tasks = await rig.tasks(id);
  assert.strictEqual(tasks.length, 4);
  assert.strictEqual(tasks[2].kind, 'implement');
  assert.strictEqual(tasks[3].kind, 'review');
});

withRig('fixes for one agent are combined into one run, with all their folders', {
  script: {
    1: [(c) => c.report({ status: 'changes_requested', summary: 'bugs', fixes: [
      { assignee: 'antigravity', goal: 'fix login', scope: ['frontend/'] },
      { assignee: 'antigravity', goal: 'fix charts', scope: ['frontend/', 'docs/ui.md'] },
      { assignee: 'claude', goal: 'fix api', scope: ['backend/'] }
    ] })],
    2: [(c) => { c.write('frontend/a.js'); c.write('docs/ui.md'); c.report({ status: 'done', summary: 'ui fixed' }); }],
    3: [writes('backend/a.js')],
    4: [(c) => c.report({ status: 'done', summary: 'clean' })]
  }
}, async (rig) => {
  const { id } = await rig.create([step(1, 'claude', [], { kind: 'review' })]);
  await rig.drive();
  assert.strictEqual((await rig.workflow(id)).status, 'done');
  const tasks = await rig.tasks(id);
  assert.deepStrictEqual(tasks.map((t) => t.assignee), ['claude', 'antigravity', 'claude', 'claude']);
  const merged = JSON.parse(tasks[1].payload_json);
  assert.match(merged.goal, /1\. fix login\n2\. fix charts/);
  assert.deepStrictEqual(merged.scope, ['frontend/', 'docs/ui.md']);
  assert.deepStrictEqual(JSON.parse(tasks[3].depends_json), [2, 3]);
});

withRig('an agent changing an ignored file outside its folder raises a warning, without failing', {
  script: {
    1: [(c) => { c.write('backend/.env', 'changed by agent'); c.write('frontend/a.js'); c.report({ status: 'done', summary: 'x' }); }],
    2: [writes('frontend/b.js')]
  }
}, async (rig) => {
  const { id } = await rig.create([step(1, 'antigravity', ['frontend/']), step(2, 'antigravity', ['frontend/'])]);
  fs.mkdirSync(path.join(rig.workspace, 'backend'), { recursive: true });
  fs.writeFileSync(path.join(rig.workspace, 'backend', '.env'), 'original');
  await rig.drive();
  assert.strictEqual((await rig.workflow(id)).status, 'done');
  const warnings = rig.sent.filter((m) => /ignored file/.test(m.subject));
  assert.strictEqual(warnings.length, 1, 'only the step that changed it is reported');
  assert.match(warnings[0].body, /backend\/\.env/);
  assert.strictEqual(fs.readFileSync(path.join(rig.workspace, 'backend', '.env'), 'utf8'), 'changed by agent');
});

withRig('review that never passes stops at the round limit and asks the owner', {
  script: {
    1: [(c) => c.report({ status: 'changes_requested', summary: 'still bad', fixes: [{ assignee: 'claude', goal: 'fix', scope: ['b/'] }] })],
    2: [writes('b/1.js')],
    3: [(c) => c.report({ status: 'changes_requested', summary: 'still bad', fixes: [{ assignee: 'claude', goal: 'fix', scope: ['b/'] }] })],
    4: [writes('b/2.js')],
    5: [(c) => c.report({ status: 'changes_requested', summary: 'still bad', fixes: [{ assignee: 'claude', goal: 'fix', scope: ['b/'] }] })]
  }
}, async (rig) => {
  const { id } = await rig.create([step(1, 'claude', [], { kind: 'review' })]);
  await rig.drive();
  assert.strictEqual((await rig.workflow(id)).status, 'blocked');
  const mail = rig.sent.find((m) => /Your answer needed/.test(m.subject));
  assert.match(mail.body, /1\. \[claude\] fix/, 'the owner can see which fixes remain');
  assert.match(mail.body, /fix them/);
  assert.strictEqual((await rig.tasks(id)).length, 5);
});

withRig('at the round limit, "fix them" runs one more round and "accept" ends the work', {
  script: {
    1: [(c) => c.report({ status: 'changes_requested', summary: 'bad', fixes: [{ assignee: 'claude', goal: 'fix', scope: ['b/'] }] }),
        (c) => c.report({ status: 'changes_requested', summary: 'bad', fixes: [{ assignee: 'claude', goal: 'fix', scope: ['b/'] }] })],
    2: [writes('b/final.js')],
    3: [(c) => c.report({ status: 'done', summary: 'accepted by owner' })]
  },
  config: { maxReviewRounds: 0 }
}, async (rig) => {
  const { id } = await rig.create([step(1, 'claude', [], { kind: 'review' })]);
  await rig.drive();
  assert.strictEqual((await rig.workflow(id)).status, 'blocked');
  const [review] = await rig.tasks(id);
  await answerTask(rig.db, review.id, 'fix them');
  await rig.drive();
  const tasks = await rig.tasks(id);
  assert.strictEqual(tasks[1].kind, 'implement', 'fixes were actually sent');
  assert.ok(fs.existsSync(path.join(rig.workspace, 'b', 'final.js')));
  assert.strictEqual((await rig.workflow(id)).status, 'done');
});

withRig('Claude quota: pause, email once, resume by itself when the wait is over', {
  script: { 1: [() => ({ ok: false, failure: 'quota', error: 'usage limit reached' }), writes('b/a.js')] }
}, async (rig) => {
  const { id } = await rig.create([step(1, 'claude', ['b/'])]);
  await rig.drive();
  assert.strictEqual((await rig.workflow(id)).status, 'paused');
  assert.strictEqual((await rig.tasks(id))[0].status, 'paused');
  assert.strictEqual(rig.sent.filter((m) => /Claude Code stopped/.test(m.subject)).length, 1);
  assert.strictEqual(rig.prompts.length, 1, 'no hammering while paused');

  await rig.db.run('UPDATE tasks SET resume_at=? WHERE workflow_id=?', [toSql(Date.now() - 1000), id]);
  await rig.drive();
  assert.strictEqual((await rig.workflow(id)).status, 'done');
});

withRig('Claude login expired: pause until the owner resumes', {
  script: { 1: [() => ({ ok: false, failure: 'auth', error: 'not logged in' }), writes('b/a.js')] }
}, async (rig) => {
  const { id } = await rig.create([step(1, 'claude', ['b/'])]);
  await rig.drive();
  assert.strictEqual((await rig.workflow(id)).status, 'paused');
  assert.strictEqual((await rig.tasks(id))[0].resume_at, null);
  await resumeWorkflow(rig.db, id);
  await rig.drive();
  assert.strictEqual((await rig.workflow(id)).status, 'done');
});

withRig('generic Claude crash retries, then fails', {
  script: { 1: [() => ({ ok: false, failure: 'error', error: 'boom' })] }
}, async (rig) => {
  const { id } = await rig.create([step(1, 'claude', ['b/'])]);
  await rig.drive();
  assert.strictEqual((await rig.tasks(id))[0].status, 'failed');
  assert.strictEqual(rig.prompts.length, 3);
});

withRig('passing 80% of the usage guard warns once and keeps going', {
  script: {
    1: [(c) => { c.write('b/a.js'); c.report({ status: 'done', summary: 'x' }); return { cost_usd: 21 }; }],
    2: [(c) => { c.write('c/a.js'); c.report({ status: 'done', summary: 'x' }); return { cost_usd: 1 }; }]
  }
}, async (rig) => {
  const { id } = await rig.create([step(1, 'claude', ['b/']), { ...step(2, 'claude', ['c/']), depends_on: [1] }]);
  await rig.drive();
  assert.strictEqual((await rig.workflow(id)).status, 'done');
  assert.strictEqual(rig.sent.filter((m) => /Usage at 80%/.test(m.subject)).length, 1);
  assert.ok(!rig.sent.some((m) => /Budget limit/.test(m.subject)));
});

withRig('usage guard pauses the workflow between steps', {
  script: { 1: [(c) => { c.write('b/a.js'); c.report({ status: 'done', summary: 'x' }); return { cost_usd: 30 }; }] }
}, async (rig) => {
  const { id } = await rig.create([step(1, 'claude', ['b/']), step(2, 'claude', ['c/'])]);
  await rig.drive();
  assert.strictEqual((await rig.workflow(id)).status, 'paused');
  assert.strictEqual(rig.prompts.length, 1);
  assert.ok(rig.sent.some((m) => /Budget limit/.test(m.subject)));
  await resumeWorkflow(rig.db, id, 50);
  await rig.drive();
  assert.strictEqual((await rig.workflow(id)).status, 'done');
});

withRig('Antigravity quota: pause and email, same as Claude', {
  script: { 1: [() => ({ ok: false, failure: 'quota', error: 'RESOURCE_EXHAUSTED' }), writes('f/a.js')] }
}, async (rig) => {
  const { id } = await rig.create([step(1, 'antigravity', ['f/'])]);
  await rig.drive();
  assert.strictEqual((await rig.workflow(id)).status, 'paused');
  assert.ok(rig.sent.some((m) => /Antigravity stopped/.test(m.subject)));
  await rig.db.run('UPDATE tasks SET resume_at=? WHERE workflow_id=?', [toSql(Date.now() - 1000), id]);
  await rig.drive();
  assert.strictEqual((await rig.workflow(id)).status, 'done');
});

withRig('an agent that quits without a result file is sent back, and then fails: never counted as done', {
  script: { 1: [() => ({ summary: 'Wait for subagent completion...' })] }
}, async (rig) => {
  const { id } = await rig.create([step(1, 'antigravity', ['f/'])]);
  await rig.drive();
  const [t] = await rig.tasks(id);
  assert.strictEqual(t.status, 'failed');
  assert.strictEqual(rig.prompts.length, 3);
  assert.match(rig.prompts[1].prompt, /without writing the result file/);
  assert.match(JSON.parse(t.result_json).error, /never wrote its result file.*Wait for subagent/);
});

withRig('the second attempt can still finish the step after a missing result file', {
  script: { 1: [() => ({ summary: 'Wait for subagent completion...' }), writes('f/a.js')] }
}, async (rig) => {
  const { id } = await rig.create([step(1, 'antigravity', ['f/'])]);
  await rig.drive();
  assert.strictEqual((await rig.workflow(id)).status, 'done');
});

test('crash recovery: interrupted tasks run again, and give up after too many interruptions', async () => {
  const rig = await createRig({ script: { 1: [writes('b/a.js')], 2: [writes('f/a.js')] } }).setup();
  try {
    const { id } = await rig.create([step(1, 'claude', ['b/']), step(2, 'antigravity', ['f/'])]);
    const sha = (await git(rig.workspace, ['rev-parse', 'HEAD'])).trim();
    await rig.db.run("UPDATE tasks SET status='ready' WHERE workflow_id=? AND seq=1", [id]);
    await rig.db.run("UPDATE tasks SET status='claimed', claimed_at=datetime('now'), base_sha=? WHERE workflow_id=? AND seq=1", [sha, id]);
    const engine = rig.newEngine();
    await engine.recover();
    const [c] = await rig.tasks(id);
    assert.strictEqual(c.status, 'ready');
    assert.strictEqual(c.retries, 1);
    await rig.drive(engine);
    assert.strictEqual((await rig.workflow(id)).status, 'done');

    const second = await rig.create([step(1, 'claude', ['z/'])], { title: 'Second' });
    await rig.db.run("UPDATE tasks SET status='ready' WHERE workflow_id=?", [second.id]);
    await rig.db.run("UPDATE tasks SET status='claimed', retries=2 WHERE workflow_id=?", [second.id]);
    await rig.newEngine().recover();
    assert.strictEqual((await rig.tasks(second.id))[0].status, 'failed');
  } finally { await rig.close(); }
});

test('downtime notice after the system was off, none after a quick restart', async () => {
  const rig = await createRig().setup();
  try {
    await rig.create([step(1, 'claude', ['b/'])]);
    await rig.db.run("INSERT OR REPLACE INTO system_state (key,value) VALUES ('last_alive',?)", [String(Date.now() - 60000)]);
    await rig.newEngine().recover();
    await rig.notifier.flush();
    assert.strictEqual(rig.sent.length, 0);
    await rig.db.run("INSERT OR REPLACE INTO system_state (key,value) VALUES ('last_alive',?)", [String(Date.now() - 3600000)]);
    await rig.newEngine().recover();
    await rig.notifier.flush();
    assert.ok(rig.sent.some((m) => /System was offline/.test(m.subject)));
  } finally { await rig.close(); }
});

test('battery: warn once at 20, hold new work at 10, resume on charger', async () => {
  let reading = { percent: 50, charging: false };
  const rig = await createRig({ battery: async () => reading }).setup();
  try {
    const { id } = await rig.create([step(1, 'claude', ['b/'])]);
    await rig.engine.watchdog();
    await rig.notifier.flush();
    assert.strictEqual(rig.sent.length, 0);

    reading = { percent: 19, charging: false };
    await rig.engine.watchdog();
    await rig.engine.watchdog();
    await rig.notifier.flush();
    assert.strictEqual(rig.sent.filter((m) => /Battery low/.test(m.subject)).length, 1);

    reading = { percent: 9, charging: false };
    await rig.engine.watchdog();
    await rig.notifier.flush();
    assert.ok(rig.sent.some((m) => /URGENT/.test(m.subject)));
    assert.strictEqual(rig.engine.isHolding(), true);
    await rig.drive();
    assert.strictEqual(rig.prompts.length, 0, 'no new task on critical battery');

    reading = { percent: 12, charging: true };
    await rig.engine.watchdog();
    assert.strictEqual(rig.engine.isHolding(), false);
    await rig.drive();
    assert.strictEqual((await rig.workflow(id)).status, 'done');
  } finally { await rig.close(); }
});

test('stop kills a running Claude and releases its task without counting a retry', async () => {
  const rig = await createRig().setup();
  try {
    let finish;
    const claude = { start: () => ({ kill() { rig.killed = true; finish({ ok: false }); }, done: new Promise((r) => { finish = r; }) }) };
    const { createEngine } = require('../src/core/engine');
    const engine = createEngine({
      config: rig.config, db: rig.db, notifyDb: rig.notifyDb, notifier: rig.notifier, battery: async () => null,
      executors: { claude, antigravity: {} }, keepAwake: { set() {} }, log() {}
    });
    const { id } = await rig.create([step(1, 'claude', ['b/'])]);
    await engine.tick();
    await engine.tick();
    assert.strictEqual((await rig.tasks(id))[0].status, 'claimed');
    await engine.stop('test');
    assert.strictEqual(rig.killed, true);
    const [t] = await rig.tasks(id);
    assert.strictEqual(t.status, 'ready');
    assert.strictEqual(t.retries, 0);
  } finally { await rig.close(); }
});

withRig('cancel stops a workflow and its Claude run', {}, async (rig) => {
  const { id } = await rig.create([step(1, 'claude', ['b/']), step(2, 'claude', ['c/'])]);
  await cancelWorkflow(rig.db, id);
  await rig.drive();
  assert.deepStrictEqual(await statuses(rig, id), ['failed', 'failed']);
  assert.strictEqual(rig.prompts.length, 0);
});

test('workspace with uncommitted work is refused, nothing is lost', async () => {
  const rig = await createRig().setup();
  try {
    await rig.create([step(1, 'claude', ['b/'])]);
    fs.writeFileSync(path.join(rig.workspace, 'unsaved.txt'), 'mine');
    await assert.rejects(rig.create([step(1, 'claude', ['b/'])], { title: 'Second' }), /uncommitted changes/);
    assert.strictEqual(fs.readFileSync(path.join(rig.workspace, 'unsaved.txt'), 'utf8'), 'mine');
  } finally { await rig.close(); }
});

test('spec validation rejects bad plans', () => {
  const ok = { title: 't', goal: 'g', workspace: path.resolve('x'), tasks: [step(1, 'claude', ['b/'])] };
  assert.deepStrictEqual(validateSpec(ok), []);
  const bad = (over) => validateSpec({ ...ok, ...over }).length > 0;
  assert.ok(bad({ workspace: 'relative' }));
  assert.ok(bad({ questions: ['open?'] }));
  assert.ok(bad({ tasks: [step(1, 'chatbot', ['b/'])] }));
  assert.ok(bad({ tasks: [step(1, 'claude', ['../escape/'])] }));
  assert.ok(bad({ tasks: [step(1, 'claude', ['C:/abs/'])] }));
  assert.ok(bad({ tasks: [step(1, 'claude', ['src/*'])] }));
  assert.ok(bad({ tasks: [step(1, 'claude', ['b/'], { depends_on: [2] }), step(2, 'claude', ['c/'], { depends_on: [1] })] }));
  assert.ok(bad({ tasks: [step(1, 'claude', ['b/'], { depends_on: [] }), step(1, 'claude', ['c/'], { depends_on: [] })] }));
});
