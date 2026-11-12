// Shared test rig: a throwaway DB and git workspace, and scripted agents. No real agent runs.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { migrate } = require('../src/db/migrate');
const { openDb } = require('../src/db/connection');
const { createEngine, resultFile } = require('../src/core/engine');
const { createNotifier } = require('../src/notifications/notifier');
const { createWorkflow } = require('../src/core/workflow');

const baseConfig = {
  pollMs: 10, notifyPollMs: 10, watchdogPollMs: 10,
  verifyTimeoutMs: 60000, maxRetries: 2, maxReviewRounds: 2, maxConsults: 3,
  quotaProbeMs: 1800000, batteryWarnPct: 20, batteryCriticalPct: 10, downtimeNoticeMs: 300000,
  workflowBudgetUsd: 25, dryRun: true
};

// Tests use the English defaults, whatever this machine's own profile says.
process.env.TANDEMBRIDGE_PROFILE = path.join(os.tmpdir(), 'bridge-no-profile.json');

function write(ws, rel, text = 'x') {
  const f = path.join(ws, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, text);
}

const reportDone = (summary = 'did it') => (c) => c.report({ status: 'done', summary });

// script: { [seq]: [behaviour for attempt 1, attempt 2, ...] }, each (ctx) => void.
function createRig({ script = {}, battery = async () => null, config = {} } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-test-'));
  const dbFile = path.join(tmp, 'test.db');
  const workspace = path.join(tmp, 'ws');
  const rig = { tmp, workspace, sent: [], prompts: [], awake: [] };

  const behave = (prompt) => {
    const id = Number(prompt.match(/TandemBridge task (\d+)/)[1]);
    const seq = Number(prompt.match(/Your step \((\d+),/)[1]);
    rig.prompts.push({ id, seq, prompt });
    const steps = script[seq] || [];
    const attempt = rig.prompts.filter((p) => p.seq === seq).length;
    const step = steps[attempt - 1] || steps[steps.length - 1] || reportDone();
    return {
      step,
      ctx: {
        id, seq, prompt, workspace,
        write: (rel, text) => write(workspace, rel, text),
        report: (obj) => fs.writeFileSync(resultFile(workspace, id), JSON.stringify(obj))
      }
    };
  };

  const agent = {
    start(prompt) {
      const { step, ctx } = behave(prompt);
      const outcome = step(ctx) || {};
      return {
        kill() { rig.killed = true; },
        done: Promise.resolve({ ok: true, duration_ms: 1, summary: 'fallback summary', cost_usd: 0, failure: null, ...outcome })
      };
    }
  };
  const executors = { claude: agent, antigravity: agent };

  rig.setup = async () => {
    await migrate(dbFile);
    rig.db = await openDb(dbFile);
    rig.notifyDb = await openDb(dbFile);
    rig.config = { ...baseConfig, ...config };
    rig.notifier = createNotifier({
      db: rig.notifyDb, log() {},
      channels: { email: { enabled: true } },
      senders: { email: async (_c, m) => { rig.sent.push(m); } }
    });
    rig.engine = rig.newEngine();
    return rig;
  };
  rig.newEngine = () => createEngine({
    config: rig.config, db: rig.db, notifyDb: rig.notifyDb, executors, notifier: rig.notifier, battery,
    keepAwake: { set: (v) => rig.awake.push(v) }, log() {}
  });
  rig.create = (tasks, extra = {}) =>
    createWorkflow(rig.db, { title: 'Demo', goal: 'Test app', workspace, tasks, ...extra }, rig.config);
  rig.tasks = (wf) => rig.db.all('SELECT * FROM tasks WHERE workflow_id=? ORDER BY seq', [wf]);
  rig.workflow = (wf) => rig.db.get('SELECT * FROM workflows WHERE id=?', [wf]);
  // Ticks enough times for every scripted run to settle.
  rig.drive = async (engine = rig.engine, n = 40) => {
    for (let i = 0; i < n; i++) {
      await engine.tick();
      await engine.waitForRun();
    }
    await rig.notifier.flush();
  };
  rig.close = async () => {
    await rig.db.close();
    await rig.notifyDb.close();
    fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  };
  return rig;
}

const step = (seq, assignee, scope, more = {}) => ({
  seq, assignee, kind: 'implement', title: `step ${seq}`, goal: `do step ${seq}`, scope,
  depends_on: seq > 1 ? [seq - 1] : [], acceptance: [], verify: [], ...more
});

module.exports = { createRig, reportDone, step, baseConfig };
