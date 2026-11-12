// The scheduler. Serial: one agent works at a time. SQLite holds all state, so a crash or a
// restart loses nothing.
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { toSql } = require('../db/connection');
const { head, changedFiles, inScope, commitAll, removeEmptyRootLock, ignoredFiles } = require('./gitops');
const { cleanEnv } = require('../agents/executors');
const { AGENTS, validScopeEntry } = require('./workflow');
const { t } = require('../notifications/messages');
const { loadProfile } = require('../config/profile');
const { AGENTS: AGENTS_INFO, agentName } = require('../agents/registry');

// The agents on this owner's team, which are the ones a step may ask.
const teamAgents = () => { const { backend, frontend, reviewer } = loadProfile().team; return [...new Set([backend, frontend, reviewer])]; };

const short = (s, n = 300) => (typeof s === 'string' && s.length > n ? s.slice(0, n) + '...' : s);

const resultFile = (workspace, id) => path.join(workspace, '.bridge', `result-${id}.json`);

function readResult(file) {
  try {
    const r = JSON.parse(fs.readFileSync(file, 'utf8'));
    return r && typeof r.status === 'string' ? r : null;
  } catch (e) { return null; }       // missing, or the agent is still writing it
}

function buildPrompt(task, payload, wf, earlier) {
  const file = resultFile(wf.workspace, task.id);
  const owner = agentName(task.assignee);
  const scope = payload.scope.length ? payload.scope.join(', ') : '(none: read only, change no files)';
  const { ui_reference: reference } = JSON.parse(wf.spec_json);
  const backendGuide = fs.existsSync(path.join(wf.workspace, 'docs', 'BACKEND.md'));
  return [
    `TandemBridge task ${task.id}. You are ${owner}, working with another AI agent on one project.`,
    `Project: ${wf.title}`,
    `Project goal: ${wf.goal}`,
    `Workspace (absolute path, work only here): ${wf.workspace}`,
    '',
    `Your step (${task.seq}, ${task.kind}): ${payload.title}`,
    `Goal: ${payload.goal}`,
    `Paths you may change: ${scope}`,
    'Changing anything outside those paths fails this step. Another agent owns the rest.',
    reference && task.assignee === loadProfile().team.frontend && task.kind !== 'review'
      ? 'UI reference: read docs/design-reference/DESIGN.md and docs/design-reference/CRAFT.md, and look at docs/design-reference/screens/ if it exists, before any UI work. Follow the pack\'s colors, type, layout, motion, and hard rules, avoid everything CRAFT.md forbids (it keeps the result from looking like a generic AI-built site), and meet both checklists. It is a style reference only: never copy its text, images, logos, or code, and do not edit that folder.'
      : null,
    reference && task.kind === 'review'
      ? 'UI reference: also check the interface against docs/design-reference/DESIGN.md and docs/design-reference/CRAFT.md and their checklists. Any item from the CRAFT.md "Never ship these" list is a defect: report each one with its file.'
      : null,
    backendGuide && task.assignee === loadProfile().team.backend && task.kind !== 'review'
      ? 'Backend guide: before any server, API, or database work, read docs/BACKEND.md and follow its structure and rules. Rules marked (security) are never skipped. Meet its checklist. Do not edit that file unless your step says so.'
      : null,
    backendGuide && task.kind === 'review'
      ? 'Backend guide: check any backend code against docs/BACKEND.md and its checklist. Every broken (security) rule is a defect: report each one with its file.'
      : null,
    payload.acceptance.length ? `Acceptance:\n${payload.acceptance.map((a) => `- ${a}`).join('\n')}` : null,
    payload.verify.length ? `The orchestrator will run these afterwards and they must pass: ${payload.verify.join(' ; ')}` : null,
    earlier.length ? `Earlier steps (read their files rather than trusting these summaries):\n${earlier.join('\n')}` : null,
    payload.question ? `Question you were asked to answer: ${payload.question}` : null,
    payload.answer ? `You stopped earlier with a question. The answer is: ${payload.answer}` : null,
    payload.answer && task.kind === 'review' ? 'If the owner accepted the work as is, report status "done". Otherwise report the remaining fixes as changes_requested.' : null,
    payload.feedback ? `Your previous attempt failed: ${payload.feedback}` : null,
    '',
    'Rules: do not commit, push, or deploy (the orchestrator commits). Do not start servers that keep running. Do not ask questions in chat.',
    'Never read, change, or delete anything outside the workspace, including through scripts, and never download and run a package that the project does not depend on.',
    'Use tokens carefully, because the owner pays for every one: search (grep or glob) before opening files, read only the files your step needs and large files in parts, never read node_modules, lockfiles, or build output, and do not re-read a file you just wrote. Run the narrowest test that proves a change while you work and the full checks once at the end. Keep command output short, and do not paste whole files or logs into your answers.',
    '',
    'When you finish, your LAST action must be writing one JSON file:',
    `RESULT_FILE: ${file}`,
    'Finished: {"status":"done","summary":"what you did, in 2-5 sentences","artifacts":["important/paths"]}',
    `Cannot continue without an answer: {"status":"blocked","question":"the exact question","ask":"user"} (ask may also be ${teamAgents().filter((a) => a !== task.assignee).map((a) => `"${a}"`).join(' or ') || 'nothing else'} if that agent can answer)`,
    task.kind === 'review'
      ? 'Review found problems: {"status":"changes_requested","summary":"what is wrong","fixes":[{"assignee":"claude|antigravity","goal":"exact fix","scope":["folder/"]}]}. A fix that deletes files must list each file as an exact path in its scope.'
      : null,
    'Use real JSON with no comments.'
  ].filter((l) => l !== null).join('\n');
}

function createEngine({ config, db, notifyDb, executors, notifier, battery, keepAwake, log }) {
  let active = null;
  let stopping = false;
  let holdNew = false;                // battery critical: finish current work, start nothing new
  let batteryCycle = 0;
  let timers = [];
  const stats = { ticks: 0, dispatched: 0 };

  const event = (taskId, type, data) =>
    db.run("INSERT INTO events (task_id, agent, type, data_json) VALUES (?,'orchestrator',?,?)",
      [taskId, type, data ? JSON.stringify(data) : null]);

  const getWorkflow = (id) => db.get('SELECT * FROM workflows WHERE id=?', [id]);
  const payloadOf = (t) => JSON.parse(t.payload_json);

  async function setWorkflow(id, status) {
    const done = status === 'done' || status === 'failed';
    await db.run(`UPDATE workflows SET status=?${done ? ", completed_at=datetime('now')" : ''} WHERE id=?`, [status, id]);
  }

  // ---------- task outcomes ----------
  async function failTask(task, reason, extra = {}) {
    await db.tx(async () => {
      await db.run("UPDATE tasks SET status='failed', completed_at=datetime('now'), result_json=? WHERE id=? AND status='claimed'",
        [JSON.stringify({ ok: false, error: reason, ...extra }), task.id]);
      await event(task.id, 'failed', { reason: short(reason) });
    });
    log(`task failed id=${task.id} reason=${short(reason)}`);
    active = null;
  }

  async function retryTask(task, feedback, freshBase = false) {
    const payload = { ...payloadOf(task), feedback };
    await db.run(`UPDATE tasks SET status='ready', retries=retries+1, payload_json=?${freshBase ? ', base_sha=NULL' : ''} WHERE id=? AND status='claimed'`,
      [JSON.stringify(payload), task.id]);
    await event(task.id, 'retry', { feedback: short(feedback) });
    log(`task retry id=${task.id} retries=${task.retries + 1}`);
    active = null;
  }

  async function pauseTask(task, reason, resumeAt, subject, body) {
    await db.tx(async () => {
      await db.run("UPDATE tasks SET status='paused', resume_at=? WHERE id=? AND status='claimed'",
        [resumeAt ? toSql(resumeAt) : null, task.id]);
      await event(task.id, 'paused', { reason });
      await setWorkflow(task.workflow_id, 'paused');
    });
    await notifier.enqueue(`paused:${reason}:${task.id}`, subject, body);
    log(`task paused id=${task.id} reason=${reason}`);
    active = null;
  }

  async function nextSeq(wfId) {
    return (await db.get('SELECT MAX(seq) m FROM tasks WHERE workflow_id=?', [wfId])).m + 1;
  }

  async function addTask(wfId, seq, assignee, kind, payload, depends = [], status = 'pending') {
    return db.run('INSERT INTO tasks (workflow_id, seq, assignee, kind, status, payload_json, depends_json) VALUES (?,?,?,?,?,?,?)',
      [wfId, seq, assignee, kind, status, JSON.stringify(payload), JSON.stringify(depends)]);
  }

  async function verify(task, payload, wf) {
    for (const cmd of payload.verify) {
      log(`verify task=${task.id} cmd=${cmd}`);
      const failure = await new Promise((resolve) => {
        exec(cmd, { cwd: wf.workspace, timeout: config.verifyTimeoutMs, env: cleanEnv(), windowsHide: true, maxBuffer: 16 * 1024 * 1024 },
          (err, stdout, stderr) => {
            if (!err) return resolve(null);
            const output = (stdout + stderr).trim() || `(no output) ${err.killed ? 'timed out' : `exit code ${err.code}`}`;
            resolve(`The orchestrator's check "${cmd}" failed:\n${output.slice(-1500)}`);
          });
      });
      if (failure) return failure;
    }
    return null;
  }

  // Applies what an agent reported. Scope is checked before anything else counts.
  async function finalize(task, res, run = {}) {
    const payload = payloadOf(task);
    const wf = await getWorkflow(task.workflow_id);
    // Consumed now: a retried or answered task must not pick up this old report again.
    fs.rmSync(resultFile(wf.workspace, task.id), { force: true });
    if (removeEmptyRootLock(wf.workspace)) log(`removed empty root package-lock.json task=${task.id}`);
    // Ignored files are a warning, not a failure: test runs legitimately rewrite some of them.
    if (active && active.ignored) {
      const now = await ignoredFiles(wf.workspace);
      const touched = [...new Set([...now.keys(), ...active.ignored.keys()])]
        .filter((f) => now.get(f) !== active.ignored.get(f) && !inScope(f, payload.scope) && !inScope(`${f}/`, payload.scope));
      if (touched.length) {
        log(`ignored files changed outside scope task=${task.id}: ${touched.join(', ')}`);
        await notifier.enqueue(`ignored:${task.id}`, t('ignored_subject', { agent: task.assignee, count: touched.length }),
          t('ignored_body', { seq: task.seq, agent: task.assignee, files: touched.join('\n') }));
      }
    }
    const changed = await changedFiles(wf.workspace, task.base_sha);
    const outside = changed.filter((f) => !inScope(f, payload.scope));
    if (outside.length) {
      return failTask(task, `changed files outside its scope: ${outside.slice(0, 20).join(', ')}`, { outside, summary: short(res.summary, 500) });
    }
    const subject = `${task.seq} ${payload.title}`.slice(0, 60);

    if (res.status === 'blocked') {
      await commitAll(wf.workspace, `bridge(${wf.id}): work in progress, step ${subject}`);
      return handleBlocked(task, payload, wf, res);
    }

    if (res.status === 'changes_requested' && task.kind === 'review') {
      const round = payload.round || 0;
      const fixes = Array.isArray(res.fixes) ? res.fixes : [];
      const bad = fixes.find((f) => !AGENTS.includes(f.assignee) || !f.goal || !Array.isArray(f.scope) || !f.scope.every(validScopeEntry));
      if (!fixes.length || bad) return failTask(task, 'review asked for changes without valid fixes');
      // The owner's answer at the limit buys one more round, so "fix them" actually fixes them.
      if (round >= config.maxReviewRounds && !payload.answer) {
        const list = fixes.map((f, i) => `${i + 1}. [${f.assignee}] ${f.goal}`).join('\n');
        return handleBlocked(task, payload, wf, {
          question: t('review_limit', { fixes: list, summary: res.summary }),
          ask: 'user'
        });
      }
      await db.tx(async () => {
        await completeTask(task, { ok: true, status: res.status, summary: short(res.summary, 800), ...costOf(run) });
        let seq = await nextSeq(wf.id);
        const fixSeqs = [];
        // One run per agent: restarting an agent for each fix costs far more time and quota.
        for (const assignee of [...new Set(fixes.map((f) => f.assignee))]) {
          const own = fixes.filter((f) => f.assignee === assignee);
          await addTask(wf.id, seq, assignee, 'implement', {
            title: `Review fixes, round ${round + 1} (${own.length})`,
            goal: own.length === 1 ? own[0].goal : `Make all of these fixes:\n${own.map((f, i) => `${i + 1}. ${f.goal}`).join('\n')}`,
            scope: [...new Set(own.flatMap((f) => f.scope))],
            acceptance: [], verify: []
          });
          fixSeqs.push(seq++);
        }
        await addTask(wf.id, seq, task.assignee, 'review', { ...payload, round: round + 1, feedback: undefined, answer: undefined }, fixSeqs);
      });
      log(`review requested ${fixes.length} fix(es) wf=${wf.id} round=${round + 1}`);
      active = null;
      return;
    }

    if (res.status !== 'done') return failTask(task, `agent reported unknown status: ${res.status}`);

    const failure = await verify(task, payload, wf);
    if (failure) {
      if (task.retries < config.maxRetries) return retryTask(task, failure);
      return failTask(task, failure);
    }
    const sha = await commitAll(wf.workspace, `bridge(${wf.id}): step ${subject}`);
    await db.tx(() => completeTask(task, {
      ok: true, status: 'done', summary: short(res.summary, 800), artifacts: res.artifacts || [], commit: sha, ...costOf(run)
    }));
    if (task.kind === 'consult') await deliverConsult(task, payload, res);
    active = null;
  }

  const costOf = (run) => ({ duration_ms: run.duration_ms, cost_usd: run.cost_usd, ...(run.live_log ? { live_log: run.live_log } : {}) });

  async function completeTask(task, result) {
    await db.run("UPDATE tasks SET status='done', completed_at=datetime('now'), result_json=? WHERE id=? AND status='claimed'",
      [JSON.stringify(result), task.id]);
    await event(task.id, 'completed', { summary: short(result.summary) });
    log(`task done id=${task.id}`);
  }

  // An agent's question goes to the other agent when it can answer, otherwise to the owner.
  async function handleBlocked(task, payload, wf, res) {
    const question = res.question || 'Agent is blocked but gave no question.';
    const consults = (await db.get("SELECT COUNT(*) c FROM tasks WHERE workflow_id=? AND kind='consult'", [wf.id])).c;
    const toAgent = AGENTS.includes(res.ask) && res.ask !== task.assignee && consults < config.maxConsults;

    await db.tx(async () => {
      await db.run("UPDATE tasks SET status='blocked', payload_json=? WHERE id=? AND status='claimed'",
        [JSON.stringify({ ...payload, question: undefined, last_question: question }), task.id]);
      await event(task.id, 'blocked', { question: short(question), ask: toAgent ? res.ask : 'user' });
      if (toAgent) {
        await addTask(wf.id, await nextSeq(wf.id), res.ask, 'consult', {
          title: `Answer a question from ${task.assignee}`,
          goal: `The ${task.assignee} agent is stuck and needs your answer. Read the code and answer in "summary". Change no files.`,
          question, from_task: task.id, scope: [], acceptance: [], verify: []
        }, [], 'ready');
      } else {
        await setWorkflow(wf.id, 'blocked');
      }
    });
    log(`task blocked id=${task.id} ask=${toAgent ? res.ask : 'user'}`);
    if (!toAgent) {
      await notifier.enqueue(`blocked:${task.id}:${Date.now()}`, t('blocked_subject', { title: wf.title }),
        t('blocked_body', { agent: task.assignee, seq: task.seq, question, id: task.id }));
    }
    active = null;
  }

  async function deliverConsult(task, payload, res) {
    const asker = await db.get('SELECT * FROM tasks WHERE id=?', [payload.from_task]);
    if (!asker || asker.status !== 'blocked') return;
    const answer = `${task.assignee} says: ${res.summary}`;
    await db.run("UPDATE tasks SET status='ready', base_sha=NULL, payload_json=? WHERE id=? AND status='blocked'",
      [JSON.stringify({ ...payloadOf(asker), answer }), asker.id]);
    await event(asker.id, 'answered', { from: task.assignee });
  }

  // ---------- active task ----------
  async function handleAgentExit(task, r) {
    if (r.cost_usd) await db.run('UPDATE workflows SET spent_usd=spent_usd+? WHERE id=?', [r.cost_usd, task.workflow_id]);
    const wf = await getWorkflow(task.workflow_id);
    const res = readResult(resultFile(wf.workspace, task.id));

    // A polite exit proves nothing: an agent once said "waiting for a subagent" and quit with no
    // work done. Only the result file counts as a report.
    if (r.ok && !res) {
      const missing = `You stopped without writing the result file, so this step does not count as finished. Your last message was: ${short(r.summary, 300)}. Do the work yourself in this run, without waiting on subagents, then write the result file.`;
      if (task.retries < config.maxRetries) return retryTask(task, missing);
      return failTask(task, `agent never wrote its result file. Last message: ${short(r.summary, 300)}`);
    }
    if (res) {
      await finalize(task, res, r);
      const after = await getWorkflow(task.workflow_id);
      if (after.status === 'running' && after.spent_usd >= after.budget_usd) {
        await setWorkflow(after.id, 'paused');
        await notifier.enqueue(`budget:${after.id}`, t('budget_subject', { title: after.title }),
          t('budget_body', { spent: after.spent_usd.toFixed(2), budget: after.budget_usd, id: after.id }));
      } else if (after.status === 'running' && after.spent_usd >= after.budget_usd * (config.budgetWarnRatio || 0.8)) {
        // Sent once per workflow, so the owner can stop it before the guard does.
        await notifier.enqueue(`budget-warn:${after.id}`, t('budget_warn_subject', { title: after.title }),
          t('budget_warn_body', { spent: after.spent_usd.toFixed(2), budget: after.budget_usd, id: after.id }));
      }
      return;
    }
    const name = agentName(task.assignee);
    const login = AGENTS_INFO[task.assignee] ? AGENTS_INFO[task.assignee].login : task.assignee;
    const resume = (msg, at) => pauseTask(task, r.failure, at, t('paused_subject', { agent: name, title: wf.title }), msg);
    const vars = { agent: name, seq: task.seq, error: r.error, id: wf.id, login };
    if (r.failure === 'quota') {
      return resume(t('paused_quota', { ...vars, minutes: config.quotaProbeMs / 60000 }), Date.now() + config.quotaProbeMs);
    }
    if (r.failure === 'network') {
      return resume(t('paused_network', vars), Date.now() + 5 * 60 * 1000);
    }
    if (r.failure === 'auth') {
      return resume(t('paused_auth', vars), null);
    }
    if (r.failure === 'budget') {
      return resume(t('paused_budget', vars), null);
    }
    if (task.retries < config.maxRetries) return retryTask(task, r.error);
    return failTask(task, r.error);
  }

  async function checkActive() {
    const task = await db.get('SELECT * FROM tasks WHERE id=?', [active.id]);
    if (!task || task.status !== 'claimed') {            // cancelled from the CLI
      active.run.kill();
      active = null;
      return;
    }
    if (!active.settled) return;
    // A failure here (say, git refusing) must surface as a failed task, not repeat on every tick.
    try {
      await handleAgentExit(task, active.settled);
    } catch (e) {
      await failTask(task, `orchestrator error: ${e.message}`);
    }
  }

  // ---------- scheduling ----------
  async function resumeDue() {
    const due = await db.all("SELECT * FROM tasks WHERE status='paused' AND resume_at IS NOT NULL AND resume_at <= datetime('now')");
    for (const t of due) {
      await db.tx(async () => {
        await db.run("UPDATE tasks SET status='ready', resume_at=NULL WHERE id=? AND status='paused'", [t.id]);
        await setWorkflow(t.workflow_id, 'running');
      });
      log(`task resumed id=${t.id}`);
    }
  }

  async function finishWorkflow(wf, tasks) {
    const lines = tasks.map((t) => {
      const r = t.result_json ? JSON.parse(t.result_json) : {};
      return `${t.seq}. [${t.status}] ${t.assignee}: ${payloadOf(t).title}\n   ${r.summary || r.error || ''}`;
    }).join('\n');
    const spec = JSON.parse(wf.spec_json);
    const failed = tasks.find((t) => t.status === 'failed');
    await setWorkflow(wf.id, failed ? 'failed' : 'done');
    await notifier.enqueue(`finished:${wf.id}`,
      failed ? t('finished_failed_subject', { seq: failed.seq, title: wf.title }) : t('finished_ok_subject', { title: wf.title }),
      `Folder: ${wf.workspace}\nBranch: ${wf.branch}\n\n${lines}\n\n` +
      (spec.run_instructions && !failed ? t('finished_run', { instructions: spec.run_instructions }) : '') +
      t('finished_footer'));
    log(`workflow ${failed ? 'failed' : 'done'} id=${wf.id}`);
  }

  async function advanceWorkflows() {
    const wfs = await db.all("SELECT * FROM workflows WHERE status='running'");
    for (const wf of wfs) {
      const tasks = await db.all('SELECT * FROM tasks WHERE workflow_id=? ORDER BY seq', [wf.id]);
      if (tasks.some((t) => t.status === 'failed') || tasks.every((t) => t.status === 'done')) {
        await finishWorkflow(wf, tasks);
        continue;
      }
      const done = new Set(tasks.filter((t) => t.status === 'done').map((t) => t.seq));
      for (const t of tasks) {
        if (t.status === 'pending' && JSON.parse(t.depends_json).every((d) => done.has(d))) {
          await db.run("UPDATE tasks SET status='ready' WHERE id=? AND status='pending'", [t.id]);
        }
      }
    }
  }

  async function startNext() {
    const task = await db.get(
      `SELECT t.* FROM tasks t JOIN workflows w ON w.id=t.workflow_id
        WHERE t.status='ready' AND w.status='running' ORDER BY w.created_at, t.seq, t.id LIMIT 1`);
    if (!task) return;
    const wf = await getWorkflow(task.workflow_id);
    const file = resultFile(wf.workspace, task.id);
    const base = task.base_sha || await head(wf.workspace);
    const claim = await db.run(
      "UPDATE tasks SET status='claimed', claimed_at=datetime('now'), base_sha=? WHERE id=? AND status='ready'", [base, task.id]);
    if (claim.changes !== 1) return;
    await event(task.id, 'claimed', null);
    const claimed = await db.get('SELECT * FROM tasks WHERE id=?', [task.id]);
    active = { id: task.id, assignee: task.assignee, ignored: await ignoredFiles(wf.workspace) };
    log(`task claimed id=${task.id} assignee=${task.assignee} wf=${wf.id}`);

    fs.rmSync(file, { force: true });
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const payload = payloadOf(claimed);
    const earlierRows = await db.all(
      "SELECT seq, assignee, result_json FROM tasks WHERE workflow_id=? AND status='done' AND id<>? ORDER BY seq", [wf.id, task.id]);
    const earlier = earlierRows.map((t) => `- step ${t.seq} (${t.assignee}): ${JSON.parse(t.result_json).summary || ''}`);
    const prompt = buildPrompt(claimed, payload, wf, earlier);
    stats.dispatched++;
    const run = executors[task.assignee].start(prompt, wf.workspace, payload, { kind: task.kind });
    const mine = active;
    mine.run = run;
    run.done.then((r) => { mine.settled = r; });
    log(`task dispatched id=${task.id} target=${task.assignee}`);
  }

  async function tick() {
    stats.ticks++;
    if (stopping) return;
    if (active) await checkActive();
    await resumeDue();
    await advanceWorkflows();
    if (!active && !holdNew) await startNext();
    keepAwake.set(!!active || !!(await db.get("SELECT 1 FROM workflows WHERE status='running' LIMIT 1")));
  }

  // ---------- watchdog ----------
  async function watchdog() {
    const running = await db.get("SELECT title FROM workflows WHERE status='running' LIMIT 1");
    await notifyDb.run("INSERT OR REPLACE INTO system_state (key, value) VALUES ('last_alive', ?)", [String(Date.now())]);
    const b = await battery();
    if (!b) return;
    if (b.charging) {
      if (holdNew) {
        holdNew = false;
        log('battery recovered, new tasks allowed');
        await notifier.enqueue(`battery-ok:${batteryCycle}`, t('battery_ok_subject'), t('battery_ok_body', { percent: b.percent }));
      }
      batteryCycle = 0;
      return;
    }
    if (!batteryCycle) batteryCycle = Date.now();
    if (b.percent <= config.batteryCriticalPct) {
      if (running) await notifier.enqueue(`battery-critical:${batteryCycle}`, t('battery_critical_subject', { percent: b.percent }),
        t('battery_critical_body', { title: running.title }));
      holdNew = true;
    } else if (b.percent <= config.batteryWarnPct && running) {
      await notifier.enqueue(`battery-low:${batteryCycle}`, t('battery_low_subject', { percent: b.percent }),
        t('battery_low_body', { title: running.title }));
    }
  }

  // ---------- recovery + lifecycle ----------
  // Runs before the first tick. Anything still claimed was interrupted, so it runs again.
  // After a hard crash the old agent process can outlive us and overlap briefly with the rerun.
  async function recover() {
    const last = await db.get("SELECT value FROM system_state WHERE key='last_alive'");
    const open = await db.get("SELECT title FROM workflows WHERE status IN ('running','paused','blocked') LIMIT 1");
    const gap = last ? Date.now() - Number(last.value) : 0;
    if (open && gap > config.downtimeNoticeMs) {
      await notifier.enqueue(`downtime:${last.value}`, t('downtime_subject'),
        t('downtime_body', { since: new Date(Number(last.value)).toLocaleString(), title: open.title }));
    }
    const claimed = await db.all("SELECT * FROM tasks WHERE status='claimed'");
    for (const t of claimed) {
      if (t.retries < config.maxRetries) {
        await db.run("UPDATE tasks SET status='ready', retries=retries+1 WHERE id=? AND status='claimed'", [t.id]);
        await event(t.id, 'recovered', null);
        log(`recovered: requeued task id=${t.id}`);
      } else {
        await db.run("UPDATE tasks SET status='failed', completed_at=datetime('now'), result_json=? WHERE id=? AND status='claimed'",
          [JSON.stringify({ ok: false, error: 'interrupted too many times' }), t.id]);
        await event(t.id, 'failed', { reason: 'interrupted too many times' });
      }
    }
  }

  function every(ms, fn, name) {
    const loop = async () => {
      try { await fn(); } catch (e) { log(`${name} error: ${short(e.message)}`); }
      if (!stopping) timers.push(setTimeout(loop, ms));
    };
    loop();
  }

  async function start() {
    log(`startup pid=${process.pid} dry_run=${config.dryRun} channels=${notifier.enabled().join(',') || 'none'}`);
    await recover();
    every(config.pollMs, tick, 'tick');
    every(config.notifyPollMs, notifier.flush, 'notify');
    every(config.watchdogPollMs, watchdog, 'watchdog');
  }

  async function stop(reason = 'signal') {
    if (stopping) return;
    stopping = true;
    timers.forEach(clearTimeout);
    timers = [];
    keepAwake.set(false);
    if (active) {
      // Stop the agent first, so the task cannot run twice after a restart.
      active.run.kill();
      await Promise.race([active.run.done, new Promise((r) => setTimeout(r, 5000))]);
      await db.run("UPDATE tasks SET status='ready', claimed_at=NULL WHERE id=? AND status='claimed'", [active.id]).catch(() => {});
      await event(active.id, 'released', { reason }).catch(() => {});
      log(`task released id=${active.id}`);
    }
    active = null;
    log(`shutdown reason=${reason} ticks=${stats.ticks} dispatched=${stats.dispatched}`);
  }

  return {
    start, stop, tick, watchdog, recover, stats,
    isHolding: () => holdNew,
    getActive: () => active,
    waitForRun: () => (active && active.run ? active.run.done.then(() => new Promise((r) => setImmediate(r))) : Promise.resolve())
  };
}

module.exports = { createEngine, buildPrompt, resultFile };
