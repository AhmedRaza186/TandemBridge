const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { migrate } = require('../src/db/migrate');
const { openDb } = require('../src/db/connection');
const { backupNow, backupDue, backupsIn } = require('../src/db/backup');

async function setup() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-backup-'));
  const file = path.join(tmp, 'live.db');
  await migrate(file);
  const db = await openDb(file);
  await db.run("INSERT INTO messages (sender, receiver, content) VALUES ('claude', 'antigravity', 'kept')");
  return { db, dir: path.join(tmp, 'backups') };
}

test('a backup is a working copy of the live database', async () => {
  const { db, dir } = await setup();
  const file = await backupNow(db, { dir, keep: 5 });
  const copy = await openDb(file);
  assert.strictEqual((await copy.get('SELECT content FROM messages')).content, 'kept');
  await copy.close();
  await db.close();
});

test('only the newest copies are kept, and other files in the folder are left alone', async () => {
  const { db, dir } = await setup();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'my-notes.txt'), 'mine');
  for (let i = 0; i < 4; i++) await backupNow(db, { dir, keep: 2 }, new Date(Date.UTC(2026, 0, 1, 0, 0, i)));
  assert.deepStrictEqual(backupsIn(dir), ['tandembridge-20260101-000002.db', 'tandembridge-20260101-000003.db']);
  assert.ok(fs.existsSync(path.join(dir, 'my-notes.txt')));
  await db.close();
});

test('the owner chooses how many copies to keep and how often, and bad values are refused', () => {
  const load = (vars) => {
    const saved = { ...process.env };
    Object.assign(process.env, vars);
    try {
      delete require.cache[require.resolve('../src/config')];
      return require('../src/config').backup;
    } finally {
      for (const k of Object.keys(vars)) if (k in saved) process.env[k] = saved[k]; else delete process.env[k];
      delete require.cache[require.resolve('../src/config')];
    }
  };
  assert.deepStrictEqual(load({ BACKUP_KEEP: '30', BACKUP_EVERY_HOURS: '1.5' }), { dir: process.env.BACKUP_DIR || '', everyHours: 1.5, keep: 30 });
  assert.strictEqual(load({ BACKUP_KEEP: '' }).keep, 14);
  assert.throws(() => load({ BACKUP_KEEP: '0' }), /BACKUP_KEEP .* whole number above 0/);
  assert.throws(() => load({ BACKUP_KEEP: '2.5' }), /whole number/);
  assert.throws(() => load({ BACKUP_EVERY_HOURS: 'abc' }), /BACKUP_EVERY_HOURS/);
});

test('a backup is due when there is none, and not again until the interval passes', async () => {
  const { db, dir } = await setup();
  assert.strictEqual(backupDue({ dir, everyHours: 6 }), true);
  await backupNow(db, { dir, keep: 5 });
  assert.strictEqual(backupDue({ dir, everyHours: 6 }), false);
  assert.strictEqual(backupDue({ dir, everyHours: 6 }, Date.now() + 7 * 3600 * 1000), true);
  await db.close();
});
