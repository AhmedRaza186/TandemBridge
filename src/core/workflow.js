// Spec validation, workflow creation, and the actions a person takes from the CLI.
// Only touches the DB and the workspace, so the CLI can use it while the orchestrator runs.
const fs = require('fs');
const path = require('path');
const { prepareWorkspace, commitAll } = require('./gitops');
const { findReference, installReference } = require('./references');
const { loadProfile } = require('../config/profile');

const BACKEND_GUIDE = () => process.env.TANDEMBRIDGE_BACKEND_GUIDE || path.join(__dirname, '..', '..', 'templates', 'BACKEND.md');

// Copies the backend guide into a project that has backend work. A guide the project already has wins.
function installBackendGuide(spec) {
  const { backend } = loadProfile().team;
  if (!spec.tasks.some((t) => t.assignee === backend && t.kind === 'implement')) return false;
  const target = path.join(spec.workspace, 'docs', 'BACKEND.md');
  if (fs.existsSync(target) || !fs.existsSync(BACKEND_GUIDE())) return false;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(BACKEND_GUIDE(), target);
  return true;
}

const START = '<!-- tandembridge:start -->';
const END = '<!-- tandembridge:end -->';

// The section of the project's AGENTS.md that tells every agent which rule files to follow.
function agentsSection(workspace) {
  const has = (rel) => fs.existsSync(path.join(workspace, rel));
  const lines = [
    START,
    '## Rules for every agent working here',
    '',
    'This project is built by AI agents through TandemBridge. Read these before you change anything:',
    '',
    '- `docs/API_CONTRACT.md`: the single source of truth for every endpoint, payload, and error, once it exists. Backend and frontend both follow it exactly.'
  ];
  if (has('docs/BACKEND.md')) lines.push('- `docs/BACKEND.md`: backend structure and security rules. Rules marked (security) are never skipped.');
  if (has('docs/design-reference/DESIGN.md')) lines.push('- `docs/design-reference/DESIGN.md`: the visual style. Follow it, but never copy its text, images, logos, or code.');
  if (has('docs/design-reference/CRAFT.md')) lines.push('- `docs/design-reference/CRAFT.md`: what every interface must avoid so it does not look like a generic AI-built site.');
  lines.push(
    '',
    'Each of these files ends with a checklist. Meet it before you call your work done.',
    '',
    '- Change only the paths your task gives you. Another agent owns the rest.',
    '- Do not commit, push, or deploy. Do not edit the files above unless your task says so.',
    '- Never read, change, or delete anything outside this folder.',
    '- Use tokens carefully: search before opening files, read only what your task needs, and never read node_modules, lockfiles, or build output.',
    END
  );
  return lines.join('\n');
}

// Writes or refreshes that section, keeping anything else the project's AGENTS.md says.
function writeAgentsFile(workspace, assignees = []) {
  const file = path.join(workspace, 'AGENTS.md');
  const section = agentsSection(workspace);
  const old = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const at = old.indexOf(START);
  const end = old.indexOf(END);
  const next = at >= 0 && end > at
    ? old.slice(0, at) + section + old.slice(end + END.length)
    : (old ? old.trimEnd() + '\n\n' : '# Agent instructions\n\n') + section + '\n';
  if (next !== old) fs.writeFileSync(file, next);

  // Agents that read their own file instead (CLAUDE.md, GEMINI.md) get one that imports AGENTS.md.
  const files = [...new Set(assignees.map((a) => AGENT_INFO[a] && AGENT_INFO[a].instructionsFile).filter(Boolean))];
  for (const name of files) {
    const own = path.join(workspace, name);
    const text = fs.existsSync(own) ? fs.readFileSync(own, 'utf8') : '';
    if (!text.includes('@AGENTS.md')) fs.writeFileSync(own, (text ? text.trimEnd() + '\n\n' : '') + '@AGENTS.md\n');
  }
}

const { AGENT_IDS: AGENTS, AGENTS: AGENT_INFO } = require('../agents/registry');
const KINDS = ['implement', 'test', 'document', 'review'];

function validScopeEntry(s) {
  return typeof s === 'string' && s.length > 0 && !path.isAbsolute(s) && !s.split('/').includes('..') && !s.includes('\\') && !s.includes('*');
}

// Returns a list of problems. An empty list means the spec can run.
function validateSpec(spec) {
  const errs = [];
  if (!spec || typeof spec !== 'object') return ['spec is not an object'];
  if (!spec.title) errs.push('title missing');
  if (!spec.goal) errs.push('goal missing');
  if (!spec.workspace || !path.isAbsolute(spec.workspace)) errs.push('workspace must be an absolute path');
  if (spec.questions && spec.questions.length) errs.push(`planner still has open questions: ${spec.questions.join(' | ')}`);
  if (spec.ui_reference && !findReference(spec.ui_reference)) errs.push(`unknown ui_reference: ${spec.ui_reference}`);
  if (!Array.isArray(spec.tasks) || !spec.tasks.length) return errs.concat('tasks missing');

  const seen = new Set();
  for (const t of spec.tasks) {
    const at = `task ${t.seq}`;
    if (!Number.isInteger(t.seq) || t.seq < 1) errs.push(`${at}: seq must be a positive integer`);
    if (seen.has(t.seq)) errs.push(`${at}: duplicate seq`);
    if (!AGENTS.includes(t.assignee)) errs.push(`${at}: unknown assignee ${t.assignee}`);
    if (!KINDS.includes(t.kind)) errs.push(`${at}: unknown kind ${t.kind}`);
    if (!t.goal) errs.push(`${at}: goal missing`);
    if (!Array.isArray(t.scope) || !t.scope.every(validScopeEntry)) errs.push(`${at}: scope must list relative paths, folders ending in /`);
    for (const d of t.depends_on || []) {
      // A dependency must come earlier, which also rules out cycles.
      if (!seen.has(d)) errs.push(`${at}: depends_on ${d} must reference an earlier step`);
    }
    seen.add(t.seq);
  }
  return errs;
}

async function createWorkflow(db, spec, config) {
  const errs = validateSpec(spec);
  if (errs.length) throw new Error('invalid spec:\n- ' + errs.join('\n- '));

  const slug = spec.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'workflow';
  const id = `${slug}-${Date.now().toString(36)}`;
  const branch = `bridge/${id}`;
  await prepareWorkspace(spec.workspace, branch);
  if (spec.ui_reference) {
    installReference(spec.workspace, spec.ui_reference);
    await commitAll(spec.workspace, `bridge: add UI reference ${spec.ui_reference}`);
  }
  installBackendGuide(spec);
  writeAgentsFile(spec.workspace, spec.tasks.map((t) => t.assignee));
  await commitAll(spec.workspace, 'bridge: add agent rules');

  await db.tx(async () => {
    await db.run('INSERT INTO workflows (id, title, goal, workspace, branch, spec_json, budget_usd) VALUES (?,?,?,?,?,?,?)',
      [id, spec.title, spec.goal, spec.workspace, branch, JSON.stringify(spec), spec.budget_usd || config.workflowBudgetUsd]);
    for (const t of spec.tasks) {
      const payload = { title: t.title || t.goal.slice(0, 60), goal: t.goal, scope: t.scope, acceptance: t.acceptance || [], verify: t.verify || [] };
      await db.run('INSERT INTO tasks (workflow_id, seq, assignee, kind, payload_json, depends_json) VALUES (?,?,?,?,?,?)',
        [id, t.seq, t.assignee, t.kind, JSON.stringify(payload), JSON.stringify(t.depends_on || [])]);
    }
  });
  return { id, branch };
}

async function answerTask(db, taskId, text) {
  const t = await db.get('SELECT * FROM tasks WHERE id=?', [taskId]);
  if (!t) throw new Error(`no task ${taskId}`);
  if (t.status !== 'blocked') throw new Error(`task ${taskId} is ${t.status}, not blocked`);
  const payload = { ...JSON.parse(t.payload_json), answer: text };
  await db.tx(async () => {
    await db.run("UPDATE tasks SET status='ready', payload_json=?, base_sha=NULL WHERE id=? AND status='blocked'", [JSON.stringify(payload), taskId]);
    await db.run("INSERT INTO events (task_id, agent, type, data_json) VALUES (?,'user','answered',?)", [taskId, JSON.stringify({ text })]);
    await db.run("UPDATE workflows SET status='running' WHERE id=? AND status='blocked'", [t.workflow_id]);
  });
}

// Continues a paused workflow now, without waiting for the next automatic retry.
async function resumeWorkflow(db, id, extraBudget) {
  const wf = await db.get('SELECT * FROM workflows WHERE id=?', [id]);
  if (!wf) throw new Error(`no workflow ${id}`);
  if (wf.status !== 'paused') throw new Error(`workflow ${id} is ${wf.status}, not paused`);
  await db.tx(async () => {
    await db.run("UPDATE tasks SET status='ready', resume_at=NULL WHERE workflow_id=? AND status='paused'", [id]);
    await db.run("UPDATE workflows SET status='running', budget_usd=budget_usd+? WHERE id=?", [extraBudget || 0, id]);
  });
}

// Runs a failed workflow's failed steps again, keeping the files they already wrote.
async function retryWorkflow(db, id, note) {
  const wf = await db.get('SELECT * FROM workflows WHERE id=?', [id]);
  if (!wf) throw new Error(`no workflow ${id}`);
  if (wf.status !== 'failed') throw new Error(`workflow ${id} is ${wf.status}, not failed`);
  const failed = await db.all("SELECT * FROM tasks WHERE workflow_id=? AND status='failed'", [id]);
  const feedback = note || 'An earlier attempt at this step stopped. Its files are still in the workspace. Read them, continue from there, and do not start over.';
  await db.tx(async () => {
    for (const t of failed) {
      const payload = { ...JSON.parse(t.payload_json), feedback };
      await db.run("UPDATE tasks SET status='ready', retries=0, result_json=NULL, completed_at=NULL, payload_json=? WHERE id=? AND status='failed'",
        [JSON.stringify(payload), t.id]);
    }
    await db.run("UPDATE workflows SET status='running', completed_at=NULL WHERE id=?", [id]);
    // Sends a new final report when this run finishes.
    await db.run("DELETE FROM notifications WHERE dedupe_key=?", [`finished:${id}`]);
  });
  return failed.length;
}

async function cancelWorkflow(db, id) {
  const wf = await db.get('SELECT * FROM workflows WHERE id=?', [id]);
  if (!wf) throw new Error(`no workflow ${id}`);
  const result = JSON.stringify({ ok: false, error: 'cancelled' });
  await db.tx(async () => {
    await db.run(
      `UPDATE tasks SET status='failed', completed_at=datetime('now'), result_json=?
        WHERE workflow_id=? AND status IN ('pending','ready','claimed','paused','blocked')`, [result, id]);
    await db.run("UPDATE workflows SET status='failed', completed_at=datetime('now') WHERE id=?", [id]);
  });
}

module.exports = { AGENTS, KINDS, validateSpec, validScopeEntry, createWorkflow, installBackendGuide, writeAgentsFile, answerTask, resumeWorkflow, retryWorkflow, cancelWorkflow };
