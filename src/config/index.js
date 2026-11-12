// All tunables and paths. Secrets come from .env (never committed), see .env.example.
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
// Everything the running system writes lives here and is never committed.
const DATA = path.join(ROOT, 'data');
fs.mkdirSync(DATA, { recursive: true });
const envFile = path.join(ROOT, '.env');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);   // never overrides real env vars

const env = process.env;
const { limits } = require('./profile').loadProfile();
const usage = require('./usage').usageLevel(limits.usage);
const MIN = 60 * 1000;
const on = (v) => String(v || '').toLowerCase() === 'on';
// A bad number here could delete every backup, so it stops the start instead of guessing.
function positive(name, fallback, whole = false) {
  const raw = env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number(raw);
  if (!(n > 0) || (whole && !Number.isInteger(n))) throw new Error(`${name} in .env must be a ${whole ? 'whole number' : 'number'} above 0, not "${raw}"`);
  return n;
}
const list = (v, fallback) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : fallback);

module.exports = {
  ROOT,
  dbFile: env.TANDEMBRIDGE_DB || path.join(DATA, 'bridge.db'),
  logFile: env.TANDEMBRIDGE_LOG || path.join(DATA, 'orchestrator.log'),
  specsDir: path.join(DATA, 'specs'),
  liveDir: path.join(DATA, 'live'),           // live logs for `watch` and the IDE panel
  // A terminal window that shows each step live opens when one starts. WATCH_WINDOW=off stops it.
  watchWindow: env.WATCH_WINDOW !== 'off',
  watchPidFile: path.join(DATA, 'watch.pid'),
  pidFile: env.TANDEMBRIDGE_PID || path.join(DATA, 'orchestrator.pid'),
  dryRun: env.TANDEMBRIDGE_DRY_RUN === '1',

  // Off unless a folder is set. A cloud-synced folder gives an off-site copy.
  backup: {
    dir: env.BACKUP_DIR || '',
    everyHours: positive('BACKUP_EVERY_HOURS', 6),
    keep: positive('BACKUP_KEEP', 14, true)
  },

  pollMs: 7000,
  notifyPollMs: 30 * 1000,
  watchdogPollMs: 2 * MIN,

  claudeBin: process.platform === 'win32' ? 'claude.cmd' : 'claude',
  claudeTimeoutMs: 45 * MIN,
  // Usage level from the profile (saver, balanced, max): models, effort, and budgets. See usage.js.
  usage,
  claudeModel: env.CLAUDE_MODEL || '',          // forces one model for every Claude step
  claudeEffort: env.CLAUDE_EFFORT || '',
  taskBudgetUsd: String(env.TANDEMBRIDGE_TASK_BUDGET || limits.taskBudgetUsd || usage.taskBudgetUsd),
  // Usage guard. On a Pro or Max login this is a measure of usage at API prices, not a bill.
  workflowBudgetUsd: Number(env.TANDEMBRIDGE_WORKFLOW_BUDGET || limits.workflowBudgetUsd || usage.workflowBudgetUsd),
  budgetWarnRatio: 0.8,                          // one alert when a workflow passes 80% of its budget
  // Permission-mode acceptEdits covers file edits inside the workspace. Everything else that
  // would prompt is denied, so these are the only commands Claude may run unattended.
  claudeAllowedTools: ['Bash(npm *)', 'Bash(npx *)', 'Bash(node *)',
    'Bash(git status*)', 'Bash(git diff*)', 'Bash(git log*)'],
  // Inline code and auto-downloaded packages are the easy ways to touch files outside the project.
  claudeDeniedTools: ['Bash(git push*)', 'Bash(npm publish*)', 'Bash(node -e*)', 'Bash(node --eval*)',
    'Bash(node -p*)', 'Bash(node --print*)', 'Bash(npx -y*)', 'Bash(npx --yes*)',
    // Reading these burns tokens and never helps: installed packages, lockfiles, build output.
    'Read(**/node_modules/**)', 'Read(**/package-lock.json)', 'Read(**/yarn.lock)', 'Read(**/pnpm-lock.yaml)',
    'Read(**/dist/**)', 'Read(**/.next/**)', 'Read(**/coverage/**)'],

  // Antigravity works through its own CLI. The IDE only displays the conversation.
  antigravityCli: env.ANTIGRAVITY_CLI ||
    path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'Antigravity IDE', 'bin', 'antigravity-ide.cmd'),
  extensionId: 'local.agent-bridge-antigravity',
  vscodeCli: env.VSCODE_CLI || path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'Microsoft VS Code', 'bin', 'code.cmd'),
  agyBin: env.AGY_BIN || path.join(os.homedir(), '.gemini', 'bin', process.platform === 'win32' ? 'agy.exe' : 'agy'),
  agyModel: env.AGY_MODEL || 'gemini-3.8-flash-high',
  agyTimeoutMs: 45 * MIN,

  codexBin: env.CODEX_BIN || (process.platform === 'win32' ? 'codex.cmd' : 'codex'),
  codexModel: env.CODEX_MODEL || '',
  copilotBin: env.COPILOT_BIN || (process.platform === 'win32' ? 'copilot.cmd' : 'copilot'),
  copilotModel: env.COPILOT_MODEL || '',
  geminiBin: env.GEMINI_BIN || (process.platform === 'win32' ? 'gemini.cmd' : 'gemini'),
  geminiModel: env.GEMINI_MODEL || '',
  workerTimeoutMs: 45 * MIN,
  // Shell command prefixes that Copilot and Gemini may run without asking. No node or npx:
  // inline code and downloaded packages are the easy ways out of the project.
  shellAllow: ['npm install', 'npm ci', 'npm test', 'npm run', 'git status', 'git diff', 'git log'],
  shellDeny: ['git push', 'npm publish'],
  // Tried in order. Sol needs a plan that includes it; Luna is the fallback.
  plannerModels: list(env.TANDEMBRIDGE_PLANNER_MODELS, ['gpt-6.1-sol', 'gpt-6-luna']),
  plannerTimeoutMs: 15 * MIN,

  verifyTimeoutMs: 10 * MIN,
  maxRetries: 2,
  maxReviewRounds: limits.maxReviewRounds ?? 2,
  maxConsults: 3,
  quotaProbeMs: 30 * MIN,           // a paused Claude task is retried this often
  batteryWarnPct: 20,
  batteryCriticalPct: 10,
  downtimeNoticeMs: 5 * MIN,

  channels: {
    email: {
      enabled: on(env.CHANNEL_EMAIL ?? 'on'),
      host: env.SMTP_HOST || 'smtp.gmail.com',
      port: Number(env.SMTP_PORT || 465),
      secure: (env.SMTP_SECURE || 'true') === 'true',
      user: env.SMTP_USER || '',
      pass: (env.SMTP_APP_PASSWORD || '').replace(/\s+/g, ''),
      from: env.EMAIL_FROM || env.SMTP_USER || '',
      to: env.EMAIL_TO || ''
    },
    whatsapp: {
      enabled: on(env.CHANNEL_WHATSAPP ?? 'off'),
      baseUrl: env.WHATSAPP_BASE_URL || 'https://graph.facebook.com',
      apiVersion: env.WHATSAPP_API_VERSION || 'v23.0',
      token: env.WHATSAPP_TOKEN || '',
      phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID || '',
      to: env.WHATSAPP_TO || '',
      template: env.WHATSAPP_TEMPLATE || '',
      language: env.WHATSAPP_TEMPLATE_LANG || 'en'
    },
    telegram: {
      enabled: on(env.CHANNEL_TELEGRAM ?? 'off'),
      baseUrl: env.TELEGRAM_BASE_URL || 'https://api.telegram.org',
      token: env.TELEGRAM_BOT_TOKEN || '',
      chatId: env.TELEGRAM_CHAT_ID || ''
    },
    callmebot: {
      enabled: on(env.CHANNEL_CALLMEBOT ?? 'off'),
      baseUrl: env.CALLMEBOT_BASE_URL || 'https://api.callmebot.com',
      phone: env.CALLMEBOT_PHONE || '',
      apikey: env.CALLMEBOT_APIKEY || ''
    },
    ntfy: {
      enabled: on(env.CHANNEL_NTFY ?? 'off'),
      server: env.NTFY_SERVER || 'https://ntfy.sh',
      topic: env.NTFY_TOPIC || '',
      token: env.NTFY_TOKEN || ''
    }
  }
};
