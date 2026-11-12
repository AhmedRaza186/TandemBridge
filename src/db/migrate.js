// Applies the numbered files in migrations/. Idempotent: safe to re-run.
// Usage: npm run migrate
const sqlite3 = require('sqlite3');
const fs = require('fs');
const path = require('path');

const MIGRATIONS = [
  { version: 1, file: '001-initial.sql' },
  { version: 2, file: '002-workflows.sql' }
];

const statementsOf = (file) =>
  fs.readFileSync(path.join(__dirname, 'migrations', file), 'utf8')
    .split(/^--;;\s*$/m)
    .map((s) => s.trim())
    .filter(Boolean);

function migrate(dbFile) {
  const db = new sqlite3.Database(dbFile);
  const run = (sql) => new Promise((res, rej) => db.run(sql, (e) => (e ? rej(e) : res())));
  const get = (sql) => new Promise((res, rej) => db.get(sql, (e, r) => (e ? rej(e) : res(r))));

  return (async () => {
    await run('PRAGMA busy_timeout = 5000');
    await run('PRAGMA foreign_keys = OFF');   // the tasks rebuild must not cascade into events
    await get('PRAGMA journal_mode = WAL');   // persistent: agents can read while one writes

    const { user_version: current } = await get('PRAGMA user_version');
    const applied = [];
    for (const m of MIGRATIONS) {
      if (m.version <= current) continue;
      await run('BEGIN IMMEDIATE');
      try {
        for (const s of statementsOf(m.file)) await run(s);
        await run(`PRAGMA user_version = ${m.version}`);
        await run('COMMIT');
        applied.push(m.version);
      } catch (e) {
        await run('ROLLBACK').catch(() => {});
        throw new Error(`migration ${m.version} (${m.file}) failed: ${e.message}`);
      }
    }
    return { from: current, applied };
  })().finally(() => new Promise((res) => db.close(() => res())));
}

if (require.main === module) {
  const dbFile = require('../config').dbFile;
  migrate(dbFile)
    .then((r) => console.log(`db: ${dbFile}\nfrom version ${r.from}, applied: ${r.applied.join(', ') || 'none'}`))
    .catch((e) => { console.error(e.message); process.exitCode = 1; });
}

module.exports = { migrate };
