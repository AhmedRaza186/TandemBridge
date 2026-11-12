// Command line for the TandemBridge. Usage: npm run bridge -- <command>
const fs = require('fs');
const path = require('path');
const config = require('../config');
const { openDb } = require('../db/connection');
const { migrate } = require('../db/migrate');
const { createWorkflow, answerTask, resumeWorkflow, retryWorkflow, cancelWorkflow, validateSpec } = require('../core/workflow');
const { createNotifier } = require('../notifications/notifier');
const { plan } = require('../agents/planner');
const { listReferences, addReference, referenceRules } = require('../core/references');
const { MESSAGES, t } = require('../notifications/messages');
const { backupNow } = require('../db/backup');

const USAGE = `TandemBridge

  run                                 start the orchestrator (keep this terminal open)
  plan <workspace> "<idea>"           Codex writes a spec into data/specs/
       --answers "<text>"             answers to the planner's questions
  start <spec.json> [--workspace D] [--reference name]
                                      start a workflow from a spec (from plan, or pasted from ChatGPT)
  references                          list the UI style packs
  reference-add <name> <screenshots> [--url U] [--for "a, b"]
                                      add a website you like as a UI style pack
  status [workflow]                   show workflows and steps
  watch [workspace]                   follow the running step live in this terminal
  limits                              check how much of the Claude plan is left (one tiny Haiku call)
  set-key <NAME> [value]              put a setting in .env; secrets are typed hidden, in your own terminal
  keys                                which settings in .env have a value (values are never shown)
  answer <task id> "<text>"           answer a blocked agent
  resume <workflow> [--budget N]      continue a paused workflow
  retry <workflow> ["<note>"]         run a failed workflow's failed steps again, keeping their files
  cancel <workflow>                   stop a workflow
  notify-test                         send a test alert on every enabled channel
  backup                              copy the database to BACKUP_DIR now
  ntfy-topic                          make a private topic name for ntfy phone alerts
  telegram-chat-id                    show the chat id after you message your Telegram bot once
  agents                              which agents are installed, how to log in, and their jobs
  agent-install <agent>               install an agent's CLI (claude, codex, copilot, gemini)
  extension-install                   install the IDE side panel (Antigravity, VS Code) that shows each step live
  messages                            print every alert in English, for translating
  planner-prompt                      print the rules to paste into ChatGPT, if you plan there`;

function flag(args, name) {
  const i = args.indexOf(name);
  if (i === -1) return undefined;
  const [, value] = args.splice(i, 2);
  return value;
}

async function withDb(fn) {
  await migrate(config.dbFile);
  const db = await openDb(config.dbFile);
  try { return await fn(db); } finally { await db.close(); }
}

function printSpec(spec) {
  console.log(`\n${spec.title}\n${spec.goal}\nFolder: ${spec.workspace}\nUI reference: ${spec.ui_reference || 'none'}\n`);
  for (const t of spec.tasks) {
    console.log(`${t.seq}. [${t.assignee}] ${t.title}`);
    console.log(`   paths:  ${t.scope.join(', ') || '(read only)'}`);
    if (t.verify.length) console.log(`   checks: ${t.verify.join(' ; ')}`);
  }
}

const commands = {
  async run() {
    await require('..').main();
  },

  // Claude reports its plan limits with every run, so one tiny run refreshes them.
  // Follows the running step in this terminal. The orchestrator opens one in its own window.
  async watch(args) {
    require('../agents/watch').watch({ workspace: args[0], pidFile: args[0] ? null : config.watchPidFile });
    await new Promise(() => {});
  },

  async limits() {
    const { runCli } = require('../agents/executors');
    const { saveClaudeLimits, limitsFile } = require('../agents/live');
    let seen = false;
    const onLine = (l) => {
      try {
        const e = JSON.parse(l);
        if (e.type === 'rate_limit_event') { saveClaudeLimits(e.rate_limit_info); seen = true; }
      } catch (e) { /* not JSON */ }
    };
    const r = await runCli(config.claudeBin, ['-p', '--output-format', 'stream-json', '--verbose', '--model', 'claude-haiku-5-5', '--max-turns', '1', '--tools', ''],
      { cwd: require('os').tmpdir(), input: 'Reply with the single word ok.', timeoutMs: 120000, onLine }).done;
    if (!seen) throw new Error(`Claude did not report its limits (exit ${r.code}). ${String(r.err).slice(0, 300)}`);
    const c = JSON.parse(fs.readFileSync(limitsFile(), 'utf8')).claude;
    const show = (name, w) => w && console.log(`${name}: ${Math.round((1 - w.used) * 100)}% left, resets ${new Date(w.resetsAt).toLocaleString()}`);
    show('Claude 5 hours', c.fiveHour);
    show('Claude week', c.week);
  },

  async plan(args) {
    const answers = flag(args, '--answers');
    const [workspace, idea] = args;
    if (!workspace || !idea) throw new Error('usage: plan <workspace> "<idea>"');
    console.log('Codex is planning, this can take a few minutes...');
    const { spec, model, problems } = await plan({ idea, workspace: path.resolve(workspace), answers, config });
    fs.mkdirSync(config.specsDir, { recursive: true });
    const slug = spec.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40);
    const file = path.join(config.specsDir, `${slug}.json`);
    fs.writeFileSync(file, JSON.stringify(spec, null, 2));
    console.log(`Model: ${model}\nSpec: ${file}`);
    printSpec(spec);
    if (spec.questions.length) {
      console.log('\nThe planner has questions. Run plan again with --answers "...":');
      spec.questions.forEach((q) => console.log(`- ${q}`));
    } else if (problems.length) {
      console.log(`\nSpec has problems:\n- ${problems.join('\n- ')}`);
      process.exitCode = 1;
    } else {
      console.log(`\nReview it, then: npm run bridge -- start "${file}"`);
    }
  },

  async start(args) {
    const workspace = flag(args, '--workspace');
    const reference = flag(args, '--reference');
    if (!args[0]) throw new Error('usage: start <spec.json> [--workspace D] [--reference name]');
    const spec = JSON.parse(fs.readFileSync(args[0], 'utf8'));
    if (workspace) spec.workspace = path.resolve(workspace);
    if (reference) spec.ui_reference = reference;
    const errs = validateSpec(spec);
    if (errs.length) throw new Error(`invalid spec:\n- ${errs.join('\n- ')}`);
    await withDb(async (db) => {
      const { id, branch } = await createWorkflow(db, spec, config);
      console.log(`Workflow ${id} queued on branch ${branch}.\nThe orchestrator picks it up if "npm run bridge -- run" is running.`);
    });
  },

  async status(args) {
    await withDb(async (db) => {
      // The orchestrator writes last_alive to the database every 2 minutes. Read it from here, not
      // with tasklist, so this also answers correctly inside an agent's sandbox.
      const alive = await db.get("SELECT value FROM system_state WHERE key='last_alive'").catch(() => null);
      const ago = alive ? Math.round((Date.now() - Number(alive.value)) / 1000) : null;
      const when = (s) => (s < 120 ? `${s}s` : s < 7200 ? `${Math.round(s / 60)} min` : `${Math.round(s / 3600)} h`);
      if (ago !== null && ago <= 5 * 60) console.log(`Orchestrator: running (last seen ${when(ago)} ago)`);
      else console.log(`Orchestrator: NOT running${ago !== null ? ` (last seen ${when(ago)} ago)` : ''}. Start it in your own terminal: npm run bridge -- run`);
      const wfs = args[0]
        ? await db.all('SELECT * FROM workflows WHERE id=?', [args[0]])
        : await db.all('SELECT * FROM workflows ORDER BY created_at DESC LIMIT 10');
      if (!wfs.length) console.log('No workflows.');
      for (const w of wfs) {
        console.log(`\n${w.id} [${w.status}] ${w.title}\n  ${w.workspace} (${w.branch})  usage $${w.spent_usd.toFixed(2)} of $${w.budget_usd}`);
        const tasks = await db.all('SELECT * FROM tasks WHERE workflow_id=? ORDER BY seq', [w.id]);
        for (const t of tasks) {
          const p = JSON.parse(t.payload_json);
          const r = t.result_json ? JSON.parse(t.result_json) : null;
          console.log(`  ${t.seq}. #${t.id} ${t.status.padEnd(7)} ${t.assignee.padEnd(11)} ${p.title}`);
          if (t.status === 'blocked') console.log(`     question: ${p.last_question}`);
          if (r && r.error) console.log(`     error: ${String(r.error).slice(0, 300)}`);
        }
      }
      const queued = await db.all("SELECT channel, COUNT(*) c, MAX(last_error) e FROM notifications WHERE status='pending' GROUP BY channel");
      for (const q of queued) console.log(`\nUnsent ${q.channel} alerts: ${q.c}${q.e ? ` (last error: ${q.e})` : ''}`);
    });
  },

  async answer(args) {
    if (!args[0] || !args[1]) throw new Error('usage: answer <task id> "<text>"');
    await withDb((db) => answerTask(db, Number(args[0]), args[1]));
    console.log('Answer saved. The agent continues on the next tick.');
  },

  async resume(args) {
    const budget = Number(flag(args, '--budget') || 0);
    if (!args[0]) throw new Error('usage: resume <workflow> [--budget N]');
    await withDb((db) => resumeWorkflow(db, args[0], budget));
    console.log('Resumed.');
  },

  async retry(args) {
    if (!args[0]) throw new Error('usage: retry <workflow> ["<note>"]');
    const n = await withDb((db) => retryWorkflow(db, args[0], args[1]));
    console.log(`${n} failed step(s) queued again.`);
  },

  async cancel(args) {
    if (!args[0]) throw new Error('usage: cancel <workflow>');
    await withDb((db) => cancelWorkflow(db, args[0]));
    console.log('Cancelled. Files and commits stay on the branch.');
  },

  // Puts one value into .env. A secret is typed hidden, here in the owner's own terminal, never as
  // an argument, so it stays out of shell history and out of any AI agent's view.
  async 'set-key'(args) {
    const envFile = require('../config/env-file');
    const [key, ...rest] = args;
    if (!key) throw new Error('usage: set-key <NAME> [value]   (secrets: set-key <NAME>, then type it hidden)');
    const name = key.toUpperCase();
    let value;
    if (envFile.isSecret(name)) {
      if (rest.length) throw new Error(`${name} is a secret. Do not put it in the command: run "npm run bridge -- set-key ${name}" and type it when asked.`);
      value = await envFile.readHidden(`Paste or type ${name} (hidden), then Enter: `);
      if (!value) throw new Error('Nothing was typed. Nothing was saved.');
    } else {
      value = rest.join(' ');
      if (!rest.length) value = await new Promise((resolve) => {
        const rl = require('readline').createInterface({ input: process.stdin, output: process.stdout });
        rl.question(`${name} = `, (a) => { rl.close(); resolve(a.trim()); });
      });
    }
    const known = envFile.listKeys().some((k) => k.key === name);
    envFile.setKey(name, value);
    console.log(envFile.isSecret(name) ? `Saved ${name} in .env.` : `Saved ${name}=${value} in .env.`);
    if (!known) console.log(`Note: ${name} is not one of TandemBridge's settings (see .env.example). Check the spelling.`);
  },

  // Which settings in .env have a value. No value is ever shown.
  async keys() {
    const envFile = require('../config/env-file');
    for (const k of envFile.listKeys()) {
      const state = k.set ? 'set' : '-';
      console.log(`${k.key.padEnd(30)} ${state}`);
    }
    console.log('\nChange one with: npm run bridge -- set-key <NAME>');
  },

  async 'notify-test'() {
    await withDb(async (db) => {
      const notifier = createNotifier({ db, channels: config.channels, log: console.log });
      await notifier.enqueue(`test:${Date.now()}`, t('test_subject'), t('test_body'));
      await notifier.flush();
      const failed = await db.all("SELECT channel, last_error FROM notifications WHERE status='pending' AND dedupe_key LIKE 'test:%'");
      await db.run("DELETE FROM notifications WHERE status='pending' AND dedupe_key LIKE 'test:%'");
      if (failed.length) throw new Error(failed.map((f) => `${f.channel}: ${f.last_error}`).join('\n'));
      console.log(`Sent on: ${createNotifier({ db, channels: config.channels }).enabled().join(', ') || 'no channel enabled'}`);
    });
  },

  async backup() {
    if (!config.backup.dir) throw new Error('set BACKUP_DIR in .env first');
    await withDb(async (db) => console.log(`Backup written: ${await backupNow(db, config.backup)}`));
  },

  async 'ntfy-topic'() {
    const topic = `bridge-${require('crypto').randomBytes(12).toString('hex')}`;
    console.log(`${topic}\n\nPut it in NTFY_TOPIC in .env, set CHANNEL_NTFY=on, and subscribe to it in the ntfy app.\nKeep it private: anyone who knows it can read your alerts.`);
  },

  async 'telegram-chat-id'() {
    const { baseUrl, token } = config.channels.telegram;
    if (!token) throw new Error('set TELEGRAM_BOT_TOKEN in .env first');
    const res = await fetch(`${baseUrl}/bot${token}/getUpdates`, { signal: AbortSignal.timeout(20000) })
      .catch(() => { throw new Error('could not reach Telegram. It may be blocked on this network.'); });
    if (!res.ok) throw new Error(`Telegram refused the request (http ${res.status}). Check TELEGRAM_BOT_TOKEN.`);
    const chats = new Map((await res.json()).result.map((u) => (u.message || u.channel_post || {}).chat).filter(Boolean).map((c) => [c.id, c]));
    if (!chats.size) return console.log('No messages found. Send your bot any message on Telegram, then run this again.');
    for (const c of chats.values()) console.log(`${c.id}  ${c.first_name || c.title || ''}`);
  },

  async messages() {
    console.log(JSON.stringify(MESSAGES, null, 2));
  },

  async references() {
    const packs = listReferences();
    if (!packs.length) console.log('No UI references installed.');
    for (const r of packs) console.log(`${r.id}\n  ${r.summary}\n  Suited for: ${r.suited_for.join(', ') || '-'}`);
  },

  async 'reference-add'(args) {
    const url = flag(args, '--url');
    const title = flag(args, '--title');
    const suitedFor = (flag(args, '--for') || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (!args[0] || !args[1]) throw new Error('usage: reference-add <name> <screenshots folder or image> [--url U] [--title T] [--for "a, b"]');
    const r = addReference(args[0], args[1], { url, title, suitedFor });
    console.log(`Added ${args[0]} with ${r.images} screenshot(s).`);
    if (!r.hasGuide) console.log('No DESIGN.md was given, so the frontend agent will work out the style from the screenshots.');
  },

  async agents() {
    const { AGENTS } = require('../agents/registry');
    const { runCli } = require('../agents/executors');
    const team = require('../config/profile').loadProfile().team;
    for (const [id, a] of Object.entries(AGENTS)) {
      const bin = a.bin(config);
      const r = await runCli(bin, ['--version'], { timeoutMs: 20000, direct: /\.exe$/i.test(bin) }).done;
      const version = r.code === 0 ? (r.out.trim().split('\n')[0] || 'installed') : null;
      const roles = ['backend', 'frontend', 'reviewer'].filter((role) => team[role] === id);
      const install = a.npm ? `npm run bridge -- agent-install ${id}` : `download from ${a.url}`;
      console.log(`${id} (${a.name})\n  ${version ? `installed: ${version}` : `not installed. Install: ${install}`}`
        + `\n  Log in: ${a.loginHelp}\n  Jobs: ${roles.join(', ') || '-'}`);
    }
  },

  async 'agent-install'(args) {
    const { AGENTS } = require('../agents/registry');
    const a = AGENTS[args[0]];
    if (!a) throw new Error(`usage: agent-install <${Object.keys(AGENTS).join('|')}>`);
    if (!a.npm) return console.log(`${a.name} has no npm package. Download it from ${a.url}, then ${a.loginHelp}.`);
    console.log(`Installing ${a.name} (${a.npm}) with npm, for this user...`);
    const { spawnSync } = require('child_process');
    const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const r = spawnSync(npm, ['install', '-g', a.npm], { stdio: 'inherit', shell: process.platform === 'win32' });
    if (r.status !== 0) throw new Error(`npm install failed for ${a.npm}`);
    console.log(`\nInstalled. Next: ${a.loginHelp}. Then run: npm run bridge -- agents`);
  },

  async 'extension-install'() {
    const { installExtension } = require('../agents/extension-pack');
    const ides = [['Antigravity', config.antigravityCli], ['VS Code', config.vscodeCli]].filter(([, cli]) => fs.existsSync(cli));
    if (!ides.length) throw new Error('Neither Antigravity nor VS Code was found. Set ANTIGRAVITY_CLI or VSCODE_CLI in .env.');
    for (const [name, cli] of ides) console.log(`${name}: TandemBridge extension ${installExtension(cli).version} installed.`);
    console.log('Reload any open window (Ctrl+Shift+P, "Reload Window"). The live view is the TandemBridge icon in the side bar;'
      + ' drag it to the right side once to keep it beside the chat.');
  },

  async 'planner-prompt'() {
    console.log(require('../agents/planner').rules());
    console.log(`\n${referenceRules()}`);
    console.log(`\nAnswer with JSON only, matching this schema:\n${fs.readFileSync(path.join(__dirname, '..', '..', 'schemas', 'workflow-spec.schema.json'), 'utf8')}`);
  }
};

const [cmd, ...rest] = process.argv.slice(2);
if (!commands[cmd]) {
  console.log(USAGE);
  process.exitCode = cmd ? 1 : 0;
} else {
  commands[cmd](rest).catch((e) => { console.error(e.message); process.exitCode = 1; });
}
