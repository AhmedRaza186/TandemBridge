const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadProfile } = require('../src/config/profile');
const { MESSAGES, t } = require('../src/notifications/messages');
const { rules } = require('../src/agents/planner');
const { buildPrompt } = require('../src/core/engine');

function withProfile(data, fn) {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-profile-')), 'p.json');
  if (data) fs.writeFileSync(file, JSON.stringify(data));
  process.env.TANDEMBRIDGE_PROFILE = file;
  try { return fn(); } finally { delete process.env.TANDEMBRIDGE_PROFILE; }
}

test('with no profile, alerts are English and the default team applies', () => withProfile(null, () => {
  assert.strictEqual(t('blocked_subject', { title: 'App' }), 'Your answer needed: App');
  assert.strictEqual(loadProfile().team.frontend, 'antigravity');
}));

test('a translated alert replaces the English one, and the rest stay English', () => withProfile({ messages: { blocked_subject: 'Respuesta: {title}' } }, () => {
  assert.strictEqual(t('blocked_subject', { title: 'App' }), 'Respuesta: App');
  assert.strictEqual(t('finished_ok_subject', { title: 'App' }), 'Work complete: App');
}));

test('braces inside an inserted value are left alone', () => withProfile(null, () => {
  assert.strictEqual(t('blocked_subject', { title: 'a {seq} b' }), 'Your answer needed: a {seq} b');
}));

test('a dollar sign in the budget alert survives', () => withProfile(null, () => {
  assert.match(t('budget_body', { spent: '1.50', budget: 25, id: 'x' }), /\$1\.50 of \$25/);
}));

test('the shipped alerts contain no Roman Urdu', () => {
  assert.doesNotMatch(Object.values(MESSAGES).join(' '), /\b(kaam|jawab|ruk gaya|karein|hai)\b/i);
});

test('a bad team member is refused with a clear error', () => withProfile({ team: { frontend: 'chatbot' } }, () => {
  assert.throws(loadProfile, /team\.frontend must be one of/);
}));

test('the planner follows the team the owner chose', () => withProfile({ team: { frontend: 'claude' } }, () => {
  assert.match(rules(), /then claude builds the frontend/);
  assert.doesNotMatch(rules(), /antigravity/);
}));

test('the UI reference goes to whoever owns the frontend', () => withProfile({ team: { frontend: 'claude' } }, () => {
  const wf = { title: 't', goal: 'g', workspace: 'w', spec_json: JSON.stringify({ ui_reference: 'x' }) };
  const task = { id: 1, seq: 1, assignee: 'claude', kind: 'implement' };
  const payload = { title: 't', goal: 'g', scope: ['f/'], acceptance: [], verify: [] };
  assert.match(buildPrompt(task, payload, wf, []), /never copy its text/);
}));

test('a team of Antigravity alone runs a whole workflow, review included', async () => {
  const { createRig } = require('./helpers');
  const before = process.env.TANDEMBRIDGE_PROFILE;
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-profile-')), 'p.json');
  fs.writeFileSync(file, JSON.stringify({ team: { manager: 'copilot', backend: 'antigravity', frontend: 'antigravity', reviewer: 'antigravity' } }));
  process.env.TANDEMBRIDGE_PROFILE = file;
  try {
    assert.match(rules(), /antigravity/);
    assert.doesNotMatch(rules(), /claude/i);
    const step = (seq, kind, scope) => ({ seq, assignee: 'antigravity', kind, title: 't', goal: 'g', scope, depends_on: seq > 1 ? [seq - 1] : [], acceptance: [], verify: [] });
    const rig = await createRig().setup();
    const { id } = await rig.create([step(1, 'implement', ['backend/']), step(2, 'implement', ['frontend/']), step(3, 'review', [])]);
    assert.ok(fs.existsSync(path.join(rig.workspace, 'docs', 'BACKEND.md')));
    await rig.drive();
    assert.strictEqual((await rig.workflow(id)).status, 'done');
    assert.match(rig.prompts.find((p) => p.seq === 1).prompt, /read docs\/BACKEND\.md/);
  } finally {
    process.env.TANDEMBRIDGE_PROFILE = before;
  }
});
