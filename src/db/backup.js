// Optional copies of the database, for example into a OneDrive or Google Drive folder.
// VACUUM INTO writes a consistent snapshot even while the orchestrator is writing.
const fs = require('fs');
const path = require('path');

const NAME = /^tandembridge-\d{8}-\d{6}\.db$/;
const stamp = (d) => d.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);

// Only files this module wrote count, so other files in a shared folder are never touched.
const backupsIn = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => NAME.test(f)).sort() : []);

function prune(dir, keep) {
  const files = backupsIn(dir);
  files.slice(0, Math.max(0, files.length - keep)).forEach((f) => fs.rmSync(path.join(dir, f)));
}

async function backupNow(db, { dir, keep }, now = new Date()) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `tandembridge-${stamp(now)}.db`);
  if (fs.existsSync(file)) return file;                     // already taken this second
  await db.run('VACUUM INTO ?', [file]);
  prune(dir, keep);
  return file;
}

// Due when the newest copy is older than the interval. Read from disk, so restarts do not reset it.
function backupDue({ dir, everyHours }, now = Date.now()) {
  const newest = backupsIn(dir).pop();
  return !newest || now - fs.statSync(path.join(dir, newest)).mtimeMs >= everyHours * 3600 * 1000;
}

module.exports = { backupNow, backupDue, backupsIn };
