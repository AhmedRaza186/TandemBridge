// TandemBridge orchestrator daemon.
//   npm run bridge -- run                  run for real
//   TANDEMBRIDGE_DRY_RUN=1 ...             stub both agents (no quota, no IDE)
const fs = require('fs');
const config = require('./config');
const { openDb } = require('./db/connection');
const { migrate } = require('./db/migrate');
const { createEngine } = require('./core/engine');
const { createNotifier } = require('./notifications/notifier');
const { createDryRunExecutors } = require('./agents/executors');
const { createExecutors } = require('./agents/registry');
const { readBattery, createKeepAwake } = require('./core/system');
const { backupNow, backupDue } = require('./db/backup');
const { t } = require('./notifications/messages');

function log(line) {
  const entry = `${new Date().toISOString()} ${line}\n`;
  try { fs.appendFileSync(config.logFile, entry); } catch (e) { console.error('log write failed:', e.message); }
  process.stdout.write(entry);
}

// Two orchestrators would each treat the other's running task as abandoned.
function takeLock() {
  if (fs.existsSync(config.pidFile)) {
    const pid = Number(fs.readFileSync(config.pidFile, 'utf8'));
    try {
      process.kill(pid, 0);
      throw new Error(`orchestrator already running (pid ${pid})`);
    } catch (e) {
      if (e.code !== 'ESRCH') throw e;       // ESRCH: stale file from a dead process
    }
  }
  fs.writeFileSync(config.pidFile, String(process.pid));
}

async function main() {
  takeLock();
  const releaseLock = () => fs.rmSync(config.pidFile, { force: true });
  await migrate(config.dbFile);
  const db = await openDb(config.dbFile);
  const notifyDb = await openDb(config.dbFile);      // separate connection: never joins an engine transaction
  const notifier = createNotifier({ db: notifyDb, channels: config.channels, log });
  const executors = config.dryRun
    ? createDryRunExecutors()
    : createExecutors(config, { log });
  const engine = createEngine({ config, db, notifyDb, executors, notifier, battery: readBattery, keepAwake: createKeepAwake(), log });

  let backupTimer = null;
  if (config.backup.dir) {
    let failedDay = null;
    const checkBackup = async () => {
      if (!backupDue(config.backup)) return;
      try {
        log(`backup written ${await backupNow(notifyDb, config.backup)}`);
      } catch (e) {
        log(`backup failed: ${e.message}`);
        const day = new Date().toISOString().slice(0, 10);
        if (failedDay !== day) await notifier.enqueue(`backup-failed:${day}`, t('backup_failed_subject'), t('backup_failed_body', { dir: config.backup.dir, error: e.message }));
        failedDay = day;
      }
    };
    await checkBackup();
    backupTimer = setInterval(() => checkBackup().catch(() => {}), 10 * 60 * 1000);
  }

  const shutdown = (sig) => { clearInterval(backupTimer); return engine.stop(sig).then(() => { releaseLock(); process.exit(0); }); };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('exit', releaseLock);
  await engine.start();
}

module.exports = { main };
