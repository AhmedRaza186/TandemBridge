const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const http = require('http');
const { migrate } = require('../src/db/migrate');
const { openDb } = require('../src/db/connection');
const { createNotifier, sendEmail, sendWhatsapp, sendTelegram, sendCallmebot, sendNtfy } = require('../src/notifications/notifier');
const { classifyFailure, cleanEnv, parseAgyRun, agyCommands } = require('../src/agents/executors');
const { plan, modelRejected } = require('../src/agents/planner');
const { readBattery } = require('../src/core/system');

async function tempDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-notify-'));
  const file = path.join(dir, 't.db');
  await migrate(file);
  const db = await openDb(file);
  return { db, cleanup: async () => { await db.close(); fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } };
}

// Just enough SMTP to accept one authenticated message.
function fakeSmtp() {
  const received = { commands: [], data: '' };
  const server = net.createServer((sock) => {
    sock.write('220 fake ESMTP\r\n');
    let inData = false;
    sock.on('data', (buf) => {
      const text = buf.toString();
      if (inData) {
        received.data += text;
        if (received.data.endsWith('\r\n.\r\n')) { inData = false; sock.write('250 queued\r\n'); }
        return;
      }
      for (const line of text.split('\r\n').filter(Boolean)) {
        received.commands.push(line);
        if (/^EHLO/i.test(line)) sock.write('250-fake\r\n250 AUTH PLAIN\r\n');
        else if (/^AUTH/i.test(line)) sock.write('235 ok\r\n');
        else if (/^MAIL|^RCPT/i.test(line)) sock.write('250 ok\r\n');
        else if (/^DATA/i.test(line)) { inData = true; sock.write('354 go\r\n'); }
        else if (/^QUIT/i.test(line)) { sock.write('221 bye\r\n'); sock.end(); }
        else sock.write('250 ok\r\n');
      }
    });
    sock.on('error', () => {});
  });
  return new Promise((res) => server.listen(0, '127.0.0.1', () => res({ server, received, port: server.address().port })));
}

test('email goes out over SMTP with the right from, to, and subject', async () => {
  const smtp = await fakeSmtp();
  try {
    await sendEmail({ host: '127.0.0.1', port: smtp.port, secure: false, user: 'sender@example.com', pass: 'app-pass', from: 'sender@example.com', to: 'receiver@example.com' },
      { subject: '[TandemBridge] Kaam complete', body: 'Sab ho gaya' });
    assert.ok(smtp.received.commands.some((c) => /MAIL FROM:<sender@example.com>/.test(c)));
    assert.ok(smtp.received.commands.some((c) => /RCPT TO:<receiver@example.com>/.test(c)));
    assert.match(smtp.received.data, /Subject: \[TandemBridge\] Kaam complete/);
    assert.match(smtp.received.data, /Sab ho gaya/);
  } finally { smtp.server.close(); }
});

test('email without a password fails clearly and stays queued', async () => {
  const { db, cleanup } = await tempDb();
  try {
    const channels = { email: { enabled: true, user: 'a@b.c', pass: '', to: 'c@d.e' } };
    const n = createNotifier({ db, channels, senders: { email: sendEmail } });
    await n.enqueue('k1', 'Sub', 'Body');
    assert.strictEqual(await n.flush(), 0);
    const row = await db.get('SELECT * FROM notifications');
    assert.strictEqual(row.status, 'pending');
    assert.match(row.last_error, /not configured/);
    assert.strictEqual(row.attempts, 1);
  } finally { await cleanup(); }
});

test('offline: alert stays queued, backs off, and is delivered once back online', async () => {
  const { db, cleanup } = await tempDb();
  try {
    let online = false, sent = 0;
    const n = createNotifier({ db, channels: { email: { enabled: true } },
      senders: { email: async () => { if (!online) throw new Error('ENOTFOUND'); sent++; } } });
    await n.enqueue('k', 'S', 'B');
    await n.flush();
    assert.strictEqual(sent, 0);
    const row = await db.get('SELECT * FROM notifications');
    assert.ok(new Date(row.next_attempt_at.replace(' ', 'T') + 'Z').getTime() > Date.now());
    await n.flush();
    assert.strictEqual((await db.get('SELECT attempts FROM notifications')).attempts, 1, 'backoff respected');

    online = true;
    await db.run("UPDATE notifications SET next_attempt_at=datetime('now','-1 minute')");
    await n.flush();
    assert.strictEqual(sent, 1);
    await n.flush();
    assert.strictEqual(sent, 1, 'not sent twice');
  } finally { await cleanup(); }
});

test('same alert is deduplicated; WhatsApp stays off until switched on', async () => {
  const { db, cleanup } = await tempDb();
  try {
    const channels = { email: { enabled: true }, whatsapp: { enabled: false } };
    const calls = { email: 0, whatsapp: 0 };
    const senders = { email: async () => { calls.email++; }, whatsapp: async () => { calls.whatsapp++; } };
    const n = createNotifier({ db, channels, senders });
    assert.deepStrictEqual(n.enabled(), ['email']);
    await n.enqueue('same', 'S', 'B');
    await n.enqueue('same', 'S', 'B');
    await n.flush();
    assert.deepStrictEqual(calls, { email: 1, whatsapp: 0 });

    channels.whatsapp.enabled = true;
    await n.enqueue('new', 'S', 'B');
    await n.flush();
    assert.deepStrictEqual(calls, { email: 2, whatsapp: 1 });
  } finally { await cleanup(); }
});

test('WhatsApp sends a template with one flattened parameter, and reports errors', async () => {
  let got = null, status = 200;
  const server = http.createServer((req, res) => {
    let b = '';
    req.on('data', (d) => { b += d; });
    req.on('end', () => { got = { url: req.url, auth: req.headers.authorization, body: JSON.parse(b) }; res.statusCode = status; res.end('{"error":"nope"}'); });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    const c = { baseUrl: `http://127.0.0.1:${server.address().port}`, apiVersion: 'v23.0', token: 'tok', phoneNumberId: '123', to: '923001234567', template: 'alert', language: 'en' };
    await sendWhatsapp(c, { subject: 'Kaam', body: 'line one\nline two' });
    assert.strictEqual(got.url, '/v23.0/123/messages');
    assert.strictEqual(got.auth, 'Bearer tok');
    assert.strictEqual(got.body.type, 'template');
    assert.strictEqual(got.body.template.components[0].parameters[0].text, 'Kaam: line one line two');
    status = 401;
    await assert.rejects(sendWhatsapp(c, { subject: 'a', body: 'b' }), /whatsapp http 401/);
    await assert.rejects(sendWhatsapp({ ...c, token: '' }, { subject: 'a', body: 'b' }), /not configured/);
  } finally { server.close(); }
});

function fakeHttp(reply) {
  const seen = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
      seen.push({ url: req.url, method: req.method, body });
      const { status, text } = reply();
      res.statusCode = status;
      res.end(text);
    });
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r({ server, seen, baseUrl: `http://127.0.0.1:${server.address().port}` })));
}

test('Telegram sends to the chat, and reports errors without the token', async () => {
  let reply = { status: 200, text: '{"ok":true}' };
  const { server, seen, baseUrl } = await fakeHttp(() => reply);
  try {
    const c = { baseUrl, token: 'secret-tok', chatId: '42' };
    await sendTelegram(c, { subject: 'Done', body: 'line one\nline two' });
    assert.strictEqual(seen[0].url, '/botsecret-tok/sendMessage');
    assert.deepStrictEqual(JSON.parse(seen[0].body), { chat_id: '42', text: 'Done\n\nline one\nline two' });
    reply = { status: 401, text: '{"description":"Unauthorized"}' };
    await assert.rejects(sendTelegram(c, { subject: 'a', body: 'b' }), (e) => /telegram http 401/.test(e.message) && !e.message.includes('secret-tok'));
    await assert.rejects(sendTelegram({ ...c, chatId: '' }, { subject: 'a', body: 'b' }), /not configured/);
  } finally { server.close(); }
});

test('CallMeBot encodes the message, and treats its 203 bad-key page as a failure', async () => {
  let reply = { status: 200, text: 'Message queued' };
  const { server, seen, baseUrl } = await fakeHttp(() => reply);
  try {
    const c = { baseUrl, phone: '+923001234567', apikey: 'k3y' };
    await sendCallmebot(c, { subject: 'Done', body: 'a & b' });
    const q = new URL(seen[0].url, baseUrl).searchParams;
    assert.strictEqual(seen[0].method, 'GET');
    assert.strictEqual(q.get('phone'), '+923001234567');
    assert.strictEqual(q.get('text'), 'Done\n\na & b');
    assert.strictEqual(q.get('apikey'), 'k3y');
    reply = { status: 203, text: '<p>APIKey is invalid. Please create a new one</p>' };
    await assert.rejects(sendCallmebot(c, { subject: 'a', body: 'b' }), (e) => /rejected/.test(e.message) && !e.message.includes('k3y'));
    await assert.rejects(sendCallmebot({ ...c, apikey: '' }, { subject: 'a', body: 'b' }), /not configured/);
  } finally { server.close(); }
});

test('an alert that merely mentions an error is not mistaken for a CallMeBot failure', async () => {
  const { server, baseUrl } = await fakeHttp(() => ({ status: 200, text: 'Text to send: step failed with error, invalid config' }));
  try {
    await sendCallmebot({ baseUrl, phone: '+1', apikey: 'k' }, { subject: 'Failed', body: 'error, invalid config' });
  } finally { server.close(); }
});

test('ntfy publishes JSON, so any language works, and refuses guessable topics', async () => {
  let reply = { status: 200, text: '{}' };
  const { server, seen, baseUrl } = await fakeHttp(() => reply);
  try {
    const c = { server: `${baseUrl}/`, topic: 'bridge-0123456789abcdef0123', token: '' };
    await sendNtfy(c, { subject: 'آپ کا جواب چاہیے', body: 'line one\nline two' });
    assert.strictEqual(seen[0].url, '/');
    const sent = JSON.parse(seen[0].body);
    assert.deepStrictEqual([sent.topic, sent.title, sent.message], [c.topic, 'آپ کا جواب چاہیے', 'line one\nline two']);
    reply = { status: 429, text: 'too many' };
    await assert.rejects(sendNtfy(c, { subject: 'a', body: 'b' }), /ntfy http 429/);
    await assert.rejects(sendNtfy({ ...c, topic: 'alerts' }, { subject: 'a', body: 'b' }), /20 to 64/);
    await assert.rejects(sendNtfy({ ...c, topic: '' }, { subject: 'a', body: 'b' }), /not configured/);
  } finally { server.close(); }
});

test('failure classifier separates waiting from asking from retrying', () => {
  assert.strictEqual(classifyFailure('Claude usage limit reached, resets 3pm'), 'quota');
  assert.strictEqual(classifyFailure('API Error: 429 too many requests'), 'quota');
  assert.strictEqual(classifyFailure('error_max_budget_usd'), 'budget');
  assert.strictEqual(classifyFailure('Not logged in. Please run /login'), 'auth');
  assert.strictEqual(classifyFailure('getaddrinfo ENOTFOUND api.anthropic.com'), 'network');
  assert.strictEqual(classifyFailure('TypeError: x is undefined'), 'error');
});

test('nested-session and IDE env vars never reach child CLIs', () => {
  process.env.CLAUDECODE = '1';
  process.env.VSCODE_PID = '1';
  process.env.ELECTRON_RUN_AS_NODE = '1';
  process.env.npm_config_loglevel = 'silent';
  const env = cleanEnv();
  assert.strictEqual(env.npm_config_loglevel, undefined);
  delete process.env.CLAUDECODE; delete process.env.VSCODE_PID; delete process.env.ELECTRON_RUN_AS_NODE; delete process.env.npm_config_loglevel;
  assert.strictEqual(env.CLAUDECODE, undefined);
  assert.strictEqual(env.VSCODE_PID, undefined);
  assert.strictEqual(env.ELECTRON_RUN_AS_NODE, undefined);
  assert.ok(env.PATH || env.Path);
});

test('planner falls back to the next model when one is not on the plan', async () => {
  const tried = [];
  const exec = (_bin, args, opts) => {
    const model = args[args.indexOf('-m') + 1];
    tried.push(model);
    assert.match(opts.input, /Expense app/);
    assert.ok(args.includes('read-only'));
    if (model === 'sol') return { done: Promise.resolve({ code: 1, out: '', err: "ERROR: The 'sol' model is not supported when using Codex with a ChatGPT account." }) };
    fs.writeFileSync(args[args.indexOf('-o') + 1], JSON.stringify({
      title: 'Expense', goal: 'g', questions: [], run_instructions: 'r',
      tasks: [{ seq: 1, assignee: 'claude', kind: 'implement', title: 't', goal: 'g', scope: ['backend/'], depends_on: [], acceptance: [], verify: [] }]
    }));
    return { done: Promise.resolve({ code: 0, out: '', err: '' }) };
  };
  const r = await plan({ idea: 'Expense app', workspace: path.resolve('w'), config: { plannerModels: ['sol', 'luna'], codexBin: 'codex', plannerTimeoutMs: 1000 }, exec });
  assert.deepStrictEqual(tried, ['sol', 'luna']);
  assert.strictEqual(r.model, 'luna');
  assert.deepStrictEqual(r.problems, []);
  assert.strictEqual(r.spec.workspace, path.resolve('w'));
  assert.ok(modelRejected('model is not supported'));
});

test('planner reports a real failure instead of trying more models', async () => {
  const exec = () => ({ done: Promise.resolve({ code: 1, out: '', err: 'stream disconnected' }) });
  await assert.rejects(plan({ idea: 'x', workspace: 'w', config: { plannerModels: ['a', 'b'], codexBin: 'c', plannerTimeoutMs: 1 }, exec }), /stream disconnected/);
});

test('battery reading on this machine has the expected shape', { skip: process.platform !== 'win32' }, async () => {
  const b = await readBattery();
  if (b) {
    assert.ok(b.percent >= 0 && b.percent <= 100);
    assert.strictEqual(typeof b.charging, 'boolean');
  }
});

test('migration keeps mailbox rows and enforces the new state machine', async () => {
  const { db, cleanup } = await tempDb();
  try {
    await db.run("INSERT INTO messages (sender, receiver, content) VALUES ('claude','antigravity','hi')");
    await db.run("INSERT INTO tasks (workflow_id, seq, assignee, kind, status) VALUES ('w',1,'claude','implement','claimed')").catch(() => {});
    const t = await db.get("SELECT * FROM tasks WHERE workflow_id='w'");
    await db.run("UPDATE tasks SET status='paused' WHERE id=?", [t.id]);
    await assert.rejects(db.run("UPDATE tasks SET status='done' WHERE id=?", [t.id]), /illegal task status transition/);
    assert.strictEqual((await db.get('SELECT COUNT(*) c FROM messages')).c, 1);
  } finally { await cleanup(); }
});

test('agy output: SUCCESS with an empty reply and denied tools is a failure, not a pass', () => {
  const denied = parseAgyRun({ code: 0, ms: 1, err: 'jetski: no output produced', out: JSON.stringify({ status: 'SUCCESS', response: '', denied_actions: [{ action: 'command', display_name: 'RunCommand' }] }) });
  assert.strictEqual(denied.ok, false);
  assert.strictEqual(denied.failure, 'error');
  assert.match(denied.error, /permission denied for: RunCommand/);

  const fine = parseAgyRun({ code: 0, ms: 1, err: '', out: JSON.stringify({ status: 'SUCCESS', response: 'Built it', conversation_id: 'c1' }) });
  assert.strictEqual(fine.ok, true);
  assert.strictEqual(fine.summary, 'Built it');

  const quota = parseAgyRun({ code: 1, ms: 1, out: '', err: 'RESOURCE_EXHAUSTED: quota exceeded' });
  assert.strictEqual(quota.failure, 'quota');

  assert.strictEqual(parseAgyRun({ code: null, ms: 1, out: '', err: '', timedOut: true }).failure, 'error');
});

test('Antigravity gets exact commands for its own folders only', () => {
  const cmds = agyCommands(['frontend/']);
  assert.ok(cmds.includes('cd frontend && npm install'));
  assert.ok(cmds.includes('npm --prefix frontend install'), 'a denied form ends the whole run');
  assert.ok(cmds.includes('npm --prefix frontend run build'));
  assert.ok(cmds.every((c) => c.includes('frontend')));
  assert.ok(!cmds.some((c) => c.startsWith('git rm')), 'a whole folder grants no deletes');
  assert.deepStrictEqual(agyCommands([]), []);
  assert.deepStrictEqual(agyCommands(['README.md']), ['git rm -f -- README.md']);
});

test('a step owning exact files can delete only those and still run the project checks', () => {
  const cmds = agyCommands(['frontend/src/utils/old.ts', 'frontend/src/pages/']);
  assert.ok(cmds.includes('git rm -f -- frontend/src/utils/old.ts'));
  assert.strictEqual(cmds.filter((c) => c.startsWith('git rm')).length, 1);
  assert.ok(cmds.includes('npm --prefix frontend run build'));
  assert.ok(cmds.includes('npm --prefix frontend test'));
});
