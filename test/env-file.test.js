// Writing settings into .env without editing it by hand.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const util = require('util');
const { setKey, listKeys, isSecret, format, readHidden } = require('../src/config/env-file');

function files() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-env-'));
  const example = path.join(dir, '.env.example');
  fs.writeFileSync(example, '# Email\nCHANNEL_EMAIL=off\nSMTP_APP_PASSWORD=\n# BACKUP_DIR=\n');
  return { env: path.join(dir, '.env'), example };
}

test('the first key creates .env from the example and fills in its line', () => {
  const f = files();
  setKey('SMTP_APP_PASSWORD', 'abcd efgh ijkl', f.env, f.example);
  const text = fs.readFileSync(f.env, 'utf8');
  assert.match(text, /^# Email\nCHANNEL_EMAIL=off\nSMTP_APP_PASSWORD='abcd efgh ijkl'\n/);
  assert.strictEqual(util.parseEnv(text).SMTP_APP_PASSWORD, 'abcd efgh ijkl');
});

test('a key replaces its own line or its commented line, or is added at the end', () => {
  const f = files();
  setKey('CHANNEL_EMAIL', 'on', f.env, f.example);
  setKey('BACKUP_DIR', 'D:\\My Backups', f.env, f.example);
  setKey('NTFY_TOPIC', 'bridge-abc', f.env, f.example);
  setKey('CHANNEL_EMAIL', 'off', f.env, f.example);
  const text = fs.readFileSync(f.env, 'utf8');
  assert.strictEqual(text.match(/CHANNEL_EMAIL=/g).length, 1);
  assert.doesNotMatch(text, /# BACKUP_DIR/);
  const parsed = util.parseEnv(text);
  assert.deepStrictEqual([parsed.CHANNEL_EMAIL, parsed.BACKUP_DIR, parsed.NTFY_TOPIC], ['off', 'D:\\My Backups', 'bridge-abc']);
});

test('values with quotes and symbols are read back unchanged', () => {
  for (const v of ['p@ss#word', "it's", 'say "hi"', `both ' and "`, '']) {
    assert.strictEqual(util.parseEnv(`K=${format(v)}`).K, v, v);
  }
  assert.throws(() => format('a\nb'));
  assert.throws(() => setKey('bad-name', 'x', files().env, files().example), /not a valid name/);
});

test('secrets are recognised, and no value is ever listed', () => {
  assert.ok(['SMTP_APP_PASSWORD', 'TELEGRAM_BOT_TOKEN', 'CALLMEBOT_APIKEY', 'NTFY_TOKEN'].every(isSecret));
  assert.ok(!['NTFY_TOPIC', 'EMAIL_TO', 'CHANNEL_NTFY'].some(isSecret));
  const f = files();
  setKey('SMTP_APP_PASSWORD', 'hunter2', f.env, f.example);
  setKey('CHANNEL_EMAIL', 'on', f.env, f.example);
  const keys = listKeys(f.env, f.example);
  const pw = keys.find((k) => k.key === 'SMTP_APP_PASSWORD');
  assert.deepStrictEqual([pw.set, pw.secret], [true, true]);
  assert.strictEqual(keys.find((k) => k.key === 'CHANNEL_EMAIL').set, true);
  assert.ok(keys.some((k) => k.key === 'BACKUP_DIR' && !k.set));
  assert.ok(!JSON.stringify(keys).includes('hunter2') && !JSON.stringify(keys).includes('"on"'), 'no value is returned');
});

test('a secret cannot be typed in where no one is at a terminal, such as an agent\'s shell', async () => {
  await assert.rejects(readHidden('x: ', { input: { isTTY: false }, output: { write() {} } }), /your own terminal/);
});

test('hidden typing shows stars, handles backspace, and returns what was typed', async () => {
  const { EventEmitter } = require('events');
  const input = Object.assign(new EventEmitter(), { isTTY: true, setRawMode() {}, resume() {}, pause() {}, setEncoding() {} });
  let shown = '';
  const p = readHidden('Key: ', { input, output: { write: (s) => { shown += s; } } });
  input.emit('data', 'abX');
  input.emit('data', '\u007f');
  input.emit('data', 'c\r');
  assert.strictEqual(await p, 'abc');
  assert.ok(!shown.includes('abc'));
  assert.strictEqual(shown, 'Key: ***\x08 \x08*\n');
});
