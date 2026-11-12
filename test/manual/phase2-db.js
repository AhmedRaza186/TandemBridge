// Deterministic self-test for the Phase 2 task/state model.
// Creates a sample workflow, drives it through every transition, then removes
// only its own rows. Never touches `messages`.
// Usage: node test/manual/phase2-db.js
const sqlite3 = require('sqlite3');
const path = require('path');

const fs = require('fs');
const os = require('os');
const { migrate } = require('../../src/db/migrate');

// Always a throwaway DB: tests never touch the live agent-memory.db.
const DB = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-phase2-')), 'test.db');
const WF = 'wf-selftest';

const run = (db, sql, p = []) =>
  new Promise((res, rej) => db.run(sql, p, function (e) { e ? rej(e) : res(this); }));
const get = (db, sql, p = []) => new Promise((res, rej) => db.get(sql, p, (e, r) => (e ? rej(e) : res(r))));
const all = (db, sql, p = []) => new Promise((res, rej) => db.all(sql, p, (e, r) => (e ? rej(e) : res(r))));

let pass = 0;
const check = (label, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${label}`); }
  else { console.log(`  FAIL ${label} ${detail}`); throw new Error(`assertion failed: ${label}`); }
};

// Single-statement compare-and-swap claim. Safe if two workers race:
// SQLite serializes writers, and `AND status='ready'` makes the loser a no-op.
const CLAIM_SQL = `
  UPDATE tasks SET status = 'claimed', claimed_at = datetime('now')
   WHERE id = (SELECT id FROM tasks WHERE assignee = ? AND status = 'ready'
                ORDER BY seq, id LIMIT 1)
     AND status = 'ready'`;

(async () => {
  await migrate(DB);
  const db = new sqlite3.Database(DB);
  try {
    await run(db, 'PRAGMA busy_timeout = 5000');

    const msgsBefore = JSON.stringify(await all(db, 'SELECT * FROM messages ORDER BY id'));

    // Clean slate for this workflow only.
    await run(db, 'DELETE FROM events WHERE task_id IN (SELECT id FROM tasks WHERE workflow_id = ?)', [WF]);
    await run(db, 'DELETE FROM tasks WHERE workflow_id = ?', [WF]);

    console.log('1. create workflow + Claude task');
    await run(db,
      `INSERT INTO tasks (workflow_id, seq, assignee, kind, status, payload_json)
       VALUES (?, 1, 'claude', 'implement', 'pending', ?)`,
      [WF, JSON.stringify({ repo: 'agent-mcp-bridge', goal: 'add task model' })]);
    const t1 = await get(db, 'SELECT * FROM tasks WHERE workflow_id = ? AND seq = 1', [WF]);
    check('claude task created as pending', t1.status === 'pending' && t1.created_at);

    console.log('2. state transitions');
    const illegal = await run(db, "UPDATE tasks SET status='done' WHERE id=?", [t1.id]).catch((e) => e);
    check('illegal pending->done rejected', illegal instanceof Error && /illegal task status transition/.test(illegal.message), illegal.message || '');

    await run(db, "UPDATE tasks SET status='ready' WHERE id=? AND status='pending'", [t1.id]);
    check('pending -> ready', (await get(db, 'SELECT status FROM tasks WHERE id=?', [t1.id])).status === 'ready');

    console.log('3. atomic claim');
    const c1 = await run(db, CLAIM_SQL, ['claude']);
    const c2 = await run(db, CLAIM_SQL, ['claude']);   // second worker racing for the same task
    check('first claim wins (1 row)', c1.changes === 1, `changes=${c1.changes}`);
    check('second claim is a no-op (0 rows)', c2.changes === 0, `changes=${c2.changes}`);
    const claimed = await get(db, 'SELECT * FROM tasks WHERE id=?', [t1.id]);
    check('claimed_at stamped', claimed.status === 'claimed' && !!claimed.claimed_at);

    console.log('4. events + completion (atomic)');
    await run(db, 'BEGIN IMMEDIATE');
    await run(db, "INSERT INTO events (task_id, agent, type, data_json) VALUES (?,'claude','claimed',NULL)", [t1.id]);
    await run(db,
      `UPDATE tasks SET status='done', completed_at=datetime('now'), result_json=?
        WHERE id=? AND status='claimed'`,
      [JSON.stringify({ ok: true, files: 3, sha: 'abc1234' }), t1.id]);
    await run(db, "INSERT INTO events (task_id, agent, type, data_json) VALUES (?,'claude','completed',?)",
      [t1.id, JSON.stringify({ sha: 'abc1234' })]);
    await run(db, 'COMMIT');
    const done1 = await get(db, 'SELECT * FROM tasks WHERE id=?', [t1.id]);
    check('claude task done with result + completed_at', done1.status === 'done' && !!done1.completed_at && JSON.parse(done1.result_json).ok === true);

    console.log('5. handoff -> Antigravity task');
    await run(db, 'BEGIN IMMEDIATE');
    await run(db,
      `INSERT INTO tasks (workflow_id, seq, assignee, kind, status, payload_json)
       VALUES (?, 2, 'antigravity', 'document', 'ready', ?)`,
      [WF, JSON.stringify({ from_task: t1.id, sha: 'abc1234' })]);
    await run(db, "INSERT INTO events (task_id, agent, type, data_json) VALUES (?,'orchestrator','handoff',?)",
      [t1.id, JSON.stringify({ to: 'antigravity', seq: 2 })]);
    await run(db, 'COMMIT');
    const a1 = await get(db, 'SELECT * FROM tasks WHERE workflow_id=? AND seq=2', [WF]);
    check('antigravity task queued as ready', a1.status === 'ready' && a1.assignee === 'antigravity');

    console.log('6. antigravity claims + completes');
    const c3 = await run(db, CLAIM_SQL, ['antigravity']);
    check('antigravity claim wins', c3.changes === 1);
    await run(db, "UPDATE tasks SET status='done', completed_at=datetime('now'), result_json=? WHERE id=? AND status='claimed'",
      [JSON.stringify({ ok: true, doc: 'docs/CHANGES.md' }), a1.id]);
    await run(db, "INSERT INTO events (task_id, agent, type, data_json) VALUES (?,'antigravity','completed',?)",
      [a1.id, JSON.stringify({ doc: 'docs/CHANGES.md' })]);

    console.log('7. read final workflow result');
    const final = await all(db,
      `SELECT seq, assignee, kind, status, result_json FROM tasks WHERE workflow_id=? ORDER BY seq`, [WF]);
    check('both tasks done, ordered by seq', final.length === 2 && final.every((t) => t.status === 'done') && final[0].seq === 1);
    const evs = await all(db, 'SELECT type FROM events WHERE task_id IN (SELECT id FROM tasks WHERE workflow_id=?) ORDER BY id', [WF]);
    check('event log append-only in order', evs.map((e) => e.type).join(',') === 'claimed,completed,handoff,completed', evs.map((e) => e.type).join(','));

    console.log('8. messages table untouched');
    const msgsAfter = JSON.stringify(await all(db, 'SELECT * FROM messages ORDER BY id'));
    check('messages identical before/after', msgsBefore === msgsAfter);

    // Remove only this test's rows.
    await run(db, 'DELETE FROM events WHERE task_id IN (SELECT id FROM tasks WHERE workflow_id = ?)', [WF]);
    await run(db, 'DELETE FROM tasks WHERE workflow_id = ?', [WF]);
    const leftover = await get(db, 'SELECT COUNT(*) c FROM tasks WHERE workflow_id=?', [WF]);
    check('test rows cleaned up', leftover.c === 0);

    console.log(`\nPASS (${pass} assertions)`);
  } catch (e) {
    console.error('\nFAIL:', e.message);
    process.exitCode = 1;
    await run(db, 'ROLLBACK').catch(() => {});
  } finally {
    db.close();
  }
})();
