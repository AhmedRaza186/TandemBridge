// Outbox notifier. Channels switch on and off through config. A message stays queued
// until its channel accepts it, so alerts survive an outage or a restart.
const nodemailer = require('nodemailer');
const { toSql } = require('../db/connection');

const MAX_BACKOFF_MS = 15 * 60 * 1000;
const short = (s, n = 300) => String(s).slice(0, n);

async function sendEmail(c, msg) {
  if (!c.user || !c.pass || !c.to) throw new Error('email not configured: set SMTP_USER, SMTP_APP_PASSWORD, EMAIL_TO in .env');
  const transport = nodemailer.createTransport({
    host: c.host, port: c.port, secure: c.secure,
    auth: { user: c.user, pass: c.pass }
  });
  try {
    await transport.sendMail({ from: c.from, to: c.to, subject: msg.subject, text: msg.body });
  } finally {
    transport.close();
  }
}

// WhatsApp opens a conversation only through an approved template, so the alert travels as
// one body parameter. Meta rejects newlines inside template parameters.
async function sendWhatsapp(c, msg) {
  if (!c.token || !c.phoneNumberId || !c.to || !c.template) throw new Error('whatsapp not configured');
  const text = `${msg.subject}: ${msg.body}`.replace(/\s+/g, ' ').slice(0, 1000);
  const res = await fetch(`${c.baseUrl}/${c.apiVersion}/${c.phoneNumberId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${c.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: c.to,
      type: 'template',
      template: {
        name: c.template,
        language: { code: c.language },
        components: [{ type: 'body', parameters: [{ type: 'text', text }] }]
      }
    })
  });
  if (!res.ok) throw new Error(`whatsapp http ${res.status}: ${short(await res.text())}`);
}

async function sendTelegram(c, msg) {
  if (!c.token || !c.chatId) throw new Error('telegram not configured: set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in .env');
  const res = await fetch(`${c.baseUrl}/bot${c.token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: c.chatId, text: `${msg.subject}\n\n${msg.body}`.slice(0, 4000) })
  });
  if (!res.ok) throw new Error(`telegram http ${res.status}: ${short(await res.text())}`);
}

// CallMeBot answers a bad key with status 203, which fetch counts as ok, so the page is checked.
// It is matched narrowly because the page echoes the alert, which can contain words like "error".
async function sendCallmebot(c, msg) {
  if (!c.phone || !c.apikey) throw new Error('callmebot not configured: set CALLMEBOT_PHONE and CALLMEBOT_APIKEY in .env');
  const query = new URLSearchParams({ phone: c.phone, text: `${msg.subject}\n\n${msg.body}`.slice(0, 1000), apikey: c.apikey });
  const res = await fetch(`${c.baseUrl}/whatsapp.php?${query}`);
  const page = await res.text();
  if (!res.ok || /apikey is invalid/i.test(page)) throw new Error(`callmebot rejected the message (http ${res.status}). Check CALLMEBOT_PHONE and CALLMEBOT_APIKEY.`);
}

// Anyone who knows a topic name on a public server can read it, so short names are refused.
// JSON publishing keeps non-Latin titles out of HTTP headers, which only carry Latin-1.
async function sendNtfy(c, msg) {
  if (!c.topic) throw new Error('ntfy not configured: set NTFY_TOPIC in .env');
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(c.topic)) throw new Error('NTFY_TOPIC must be 20 to 64 letters, digits, - or _. Make one with: npm run bridge -- ntfy-topic');
  const res = await fetch(c.server.replace(/\/+$/, ''), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(c.token ? { Authorization: `Bearer ${c.token}` } : {}) },
    body: JSON.stringify({ topic: c.topic, title: msg.subject.slice(0, 250), message: msg.body.slice(0, 3800), priority: 4 })
  });
  if (!res.ok) throw new Error(`ntfy http ${res.status}: ${short(await res.text())}`);
}

const SENDERS = { email: sendEmail, whatsapp: sendWhatsapp, telegram: sendTelegram, callmebot: sendCallmebot, ntfy: sendNtfy };

function createNotifier({ db, channels, log = () => {}, senders = SENDERS }) {
  const enabled = () => Object.keys(senders).filter((name) => channels[name] && channels[name].enabled);

  // Same dedupeKey = same alert, sent once per channel.
  async function enqueue(dedupeKey, subject, body) {
    for (const channel of enabled()) {
      await db.run(
        'INSERT OR IGNORE INTO notifications (channel, dedupe_key, subject, body) VALUES (?,?,?,?)',
        [channel, dedupeKey, `[TandemBridge] ${subject}`, body]);
    }
    log(`notify queued key=${dedupeKey} subject=${subject}`);
  }

  async function flush() {
    const due = await db.all(
      "SELECT * FROM notifications WHERE status='pending' AND next_attempt_at <= datetime('now') ORDER BY id LIMIT 20");
    let sent = 0;
    for (const n of due) {
      if (!channels[n.channel] || !channels[n.channel].enabled) continue;   // channel off: keep it queued
      try {
        await senders[n.channel](channels[n.channel], n);
        await db.run("UPDATE notifications SET status='sent', sent_at=datetime('now'), last_error=NULL WHERE id=?", [n.id]);
        sent++;
        log(`notify sent id=${n.id} channel=${n.channel}`);
      } catch (e) {
        const wait = Math.min(30 * 1000 * 2 ** n.attempts, MAX_BACKOFF_MS);
        await db.run('UPDATE notifications SET attempts=attempts+1, next_attempt_at=?, last_error=? WHERE id=?',
          [toSql(Date.now() + wait), short(e.message), n.id]);
        log(`notify retry id=${n.id} channel=${n.channel} error=${short(e.message, 200)}`);
      }
    }
    return sent;
  }

  return { enqueue, flush, enabled };
}

module.exports = { createNotifier, sendEmail, sendWhatsapp, sendTelegram, sendCallmebot, sendNtfy };
