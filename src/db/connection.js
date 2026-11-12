// Thin promise wrapper over sqlite3.
const sqlite3 = require('sqlite3');

async function openDb(file) {
  const raw = new sqlite3.Database(file);
  const db = {
    run: (sql, p = []) => new Promise((res, rej) => raw.run(sql, p, function (e) { e ? rej(e) : res(this); })),
    get: (sql, p = []) => new Promise((res, rej) => raw.get(sql, p, (e, r) => (e ? rej(e) : res(r)))),
    all: (sql, p = []) => new Promise((res, rej) => raw.all(sql, p, (e, r) => (e ? rej(e) : res(r)))),
    close: () => new Promise((res) => raw.close(() => res())),
    async tx(fn) {
      await db.run('BEGIN IMMEDIATE');
      try {
        const out = await fn();
        await db.run('COMMIT');
        return out;
      } catch (e) {
        await db.run('ROLLBACK').catch(() => {});
        throw e;
      }
    }
  };
  await db.run('PRAGMA busy_timeout = 5000');
  return db;
}

// DB timestamps are UTC 'YYYY-MM-DD HH:MM:SS'.
const toMs = (s) => new Date(s.replace(' ', 'T') + 'Z').getTime();
const toSql = (ms) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');

module.exports = { openDb, toMs, toSql };
