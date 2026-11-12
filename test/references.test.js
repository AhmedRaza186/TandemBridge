const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createRig } = require('./helpers');
const { git } = require('../src/core/gitops');
const { validateSpec, installBackendGuide, writeAgentsFile } = require('../src/core/workflow');
const { listReferences, referenceRules, addReference } = require('../src/core/references');

const PACK = 'editorial-luxury-motion';
const task = (seq, assignee, kind = 'implement') => ({ seq, assignee, kind, title: 't', goal: 'g', scope: kind === 'review' ? [] : ['f/'], depends_on: [], acceptance: [], verify: [] });

// Runs fn against an empty references folder, so a test cannot touch the real packs.
function inTempRefs(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-refs-'));
  process.env.TANDEMBRIDGE_REFERENCES = dir;
  try { return fn(dir); } finally { delete process.env.TANDEMBRIDGE_REFERENCES; }
}

function shots(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-shots-'));
  files.forEach((f) => fs.writeFileSync(path.join(dir, f), 'x'));
  return dir;
}

test('built-in packs are listed and offered to the planner', () => {
  assert.ok(listReferences().some((r) => r.id === PACK));
  assert.ok(referenceRules().includes(`- ${PACK}:`));
});

test('an unknown ui_reference is rejected, and null is fine', () => {
  const spec = { title: 't', goal: 'g', workspace: path.resolve('x'), tasks: [task(1, 'claude')] };
  assert.match(validateSpec({ ...spec, ui_reference: 'nope' }).join(), /unknown ui_reference/);
  assert.deepStrictEqual(validateSpec({ ...spec, ui_reference: null }), []);
});

test('the chosen pack is committed to the project and reaches the frontend and review prompts only', async () => {
  const rig = await createRig().setup();
  const { id } = await rig.create([task(1, 'claude'), { ...task(2, 'antigravity'), depends_on: [1] }, { ...task(3, 'claude', 'review'), depends_on: [2] }], { ui_reference: PACK });
  assert.ok(fs.existsSync(path.join(rig.workspace, 'docs', 'design-reference', 'DESIGN.md')));
  assert.ok(fs.existsSync(path.join(rig.workspace, 'docs', 'design-reference', 'CRAFT.md')));
  assert.match(await git(rig.workspace, ['log', '--oneline']), new RegExp(`add UI reference ${PACK}`));
  assert.strictEqual((await git(rig.workspace, ['status', '--porcelain'])).trim(), '');

  await rig.drive();
  assert.strictEqual((await rig.workflow(id)).status, 'done');
  const bySeq = (s) => rig.prompts.find((p) => p.seq === s).prompt;
  assert.doesNotMatch(bySeq(1), /design-reference/);
  assert.match(bySeq(2), /never copy its text/);
  assert.match(bySeq(2), /CRAFT\.md/);
  assert.match(bySeq(3), /"Never ship these" list is a defect/);
  assert.match(bySeq(3), /check the interface against docs\/design-reference/);
});

test('backend work gets the backend guide, and a guide the project already has is kept', async () => {
  const rig = await createRig().setup();
  await rig.create([task(1, 'claude'), { ...task(2, 'antigravity'), depends_on: [1] }, { ...task(3, 'claude', 'review'), depends_on: [2] }]);
  const guide = path.join(rig.workspace, 'docs', 'BACKEND.md');
  assert.match(fs.readFileSync(guide, 'utf8'), /\(security\)/);
  assert.match(await git(rig.workspace, ['log', '--oneline']), /add agent rules/);
  const agents = fs.readFileSync(path.join(rig.workspace, 'AGENTS.md'), 'utf8');
  assert.match(agents, /docs\/BACKEND\.md/);
  assert.doesNotMatch(agents, /CRAFT\.md/);
  assert.match(fs.readFileSync(path.join(rig.workspace, 'CLAUDE.md'), 'utf8'), /@AGENTS\.md/);
  assert.strictEqual((await git(rig.workspace, ['status', '--porcelain'])).trim(), '');

  await rig.drive();
  const bySeq = (s) => rig.prompts.find((p) => p.seq === s).prompt;
  assert.match(bySeq(1), /read docs\/BACKEND\.md/);
  assert.doesNotMatch(bySeq(2), /BACKEND\.md/);
  assert.match(bySeq(3), /broken \(security\) rule is a defect/);

  fs.writeFileSync(guide, 'our own rules');
  assert.strictEqual(installBackendGuide({ workspace: rig.workspace, tasks: [task(1, 'claude')] }), false);
  assert.strictEqual(fs.readFileSync(guide, 'utf8'), 'our own rules');
  const front = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-front-'));
  assert.strictEqual(installBackendGuide({ workspace: front, tasks: [task(1, 'antigravity'), task(2, 'claude', 'review')] }), false);
});

test('the project AGENTS.md lists the rule files, and keeps what the project already wrote', () => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-agents-'));
  fs.mkdirSync(path.join(ws, 'docs', 'design-reference'), { recursive: true });
  fs.writeFileSync(path.join(ws, 'docs', 'design-reference', 'DESIGN.md'), 'x');
  fs.writeFileSync(path.join(ws, 'docs', 'design-reference', 'CRAFT.md'), 'x');
  fs.writeFileSync(path.join(ws, 'AGENTS.md'), '# Ours\n\nUse tabs.\n');
  fs.writeFileSync(path.join(ws, 'CLAUDE.md'), 'Be brief.\n');

  writeAgentsFile(ws, ['claude', 'antigravity']);
  const first = fs.readFileSync(path.join(ws, 'AGENTS.md'), 'utf8');
  assert.match(first, /^# Ours\n\nUse tabs\./);
  assert.match(first, /CRAFT\.md/);
  assert.doesNotMatch(first, /BACKEND\.md/);
  assert.strictEqual(fs.readFileSync(path.join(ws, 'CLAUDE.md'), 'utf8'), 'Be brief.\n\n@AGENTS.md\n');

  fs.writeFileSync(path.join(ws, 'docs', 'BACKEND.md'), 'x');
  writeAgentsFile(ws, ['claude']);
  writeAgentsFile(ws, ['claude', 'gemini']);
  assert.match(fs.readFileSync(path.join(ws, 'GEMINI.md'), 'utf8'), /@AGENTS\.md/);
  const again = fs.readFileSync(path.join(ws, 'AGENTS.md'), 'utf8');
  assert.match(again, /BACKEND\.md/);
  assert.strictEqual(again.match(/tandembridge:start/g).length, 1);
  assert.strictEqual(fs.readFileSync(path.join(ws, 'CLAUDE.md'), 'utf8').match(/@AGENTS\.md/g).length, 1);
});

test('a project without a reference gets no reference text', async () => {
  const rig = await createRig().setup();
  await rig.create([task(1, 'antigravity')]);
  await rig.drive();
  assert.doesNotMatch(rig.prompts[0].prompt, /design-reference/);
  assert.ok(!fs.existsSync(path.join(rig.workspace, 'docs')));
});

test('a user can add a site from screenshots, and it becomes a usable pack', () => inTempRefs((dir) => {
  const r = addReference('my-style', shots(['home.png', 'hero.JPG', 'notes.txt']), { url: 'https://example.com', suitedFor: ['restaurant'] });
  assert.strictEqual(r.images, 2);
  assert.deepStrictEqual(fs.readdirSync(path.join(dir, 'custom', 'my-style', 'screens')).sort(), ['hero.JPG', 'home.png']);
  assert.match(fs.readFileSync(path.join(dir, 'custom', 'my-style', 'DESIGN.md'), 'utf8'), /screens/);
  const pack = listReferences().find((p) => p.id === 'my-style');
  assert.strictEqual(pack.url, 'https://example.com');
  assert.deepStrictEqual(pack.suited_for, ['restaurant']);
}));

test('a guide supplied with the screenshots is kept', () => inTempRefs((dir) => {
  const src = shots(['DESIGN.md']);
  fs.writeFileSync(path.join(src, 'DESIGN.md'), 'my own rules');
  addReference('guided', src);
  assert.strictEqual(fs.readFileSync(path.join(dir, 'custom', 'guided', 'DESIGN.md'), 'utf8'), 'my own rules');
}));

test('bad references are refused', () => inTempRefs(() => {
  assert.throws(() => addReference('../evil', shots(['a.png'])), /lowercase/);
  assert.throws(() => addReference('Upper', shots(['a.png'])), /lowercase/);
  assert.throws(() => addReference('empty', shots(['notes.txt'])), /no screenshots/);
  assert.throws(() => addReference('gone', path.join(os.tmpdir(), 'no-such-folder-here')), /no such file/);
  addReference('taken', shots(['a.png']));
  assert.throws(() => addReference('taken', shots(['a.png'])), /already exists/);
}));
