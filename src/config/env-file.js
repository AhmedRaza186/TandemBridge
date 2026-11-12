// Reads and writes keys in .env, so the owner never has to edit the file by hand. Secret values
// are typed hidden in the owner's own terminal and are never printed, logged, or passed as
// arguments, so an AI agent helping with setup never sees them.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const ENV = path.join(ROOT, '.env');
const EXAMPLE = path.join(ROOT, '.env.example');

const NAME = /^[A-Z][A-Z0-9_]*$/;
const isSecret = (key) => /(PASSWORD|TOKEN|API_?KEY|SECRET)$/.test(key);

// One value as .env holds it: bare when safe, otherwise quoted so Node reads it back unchanged.
function format(value) {
  const v = String(value);
  if (/[\r\n]/.test(v)) throw new Error('a value cannot span lines');
  if (/^[A-Za-z0-9_@.:/+\-,~%=]*$/.test(v)) return v;
  if (!v.includes("'")) return `'${v}'`;
  if (!v.includes('"')) return `"${v}"`;
  if (!v.includes('`')) return `\`${v}\``;
  throw new Error('a value cannot contain all three quote characters');
}

// Creates .env from .env.example the first time, so every key starts in its usual place.
function ensureEnv(file = ENV, example = EXAMPLE) {
  if (!fs.existsSync(file)) fs.copyFileSync(example, file);
  return file;
}

// Sets KEY in the file: replaces its line (or a commented-out "# KEY=" line), or adds it at the end.
function setKey(key, value, file = ENV, example = EXAMPLE) {
  if (!NAME.test(key)) throw new Error(`"${key}" is not a valid name: use capital letters, digits, and _`);
  ensureEnv(file, example);
  const text = fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  const line = `${key}=${format(value)}`;
  let i = lines.findIndex((l) => new RegExp(`^\\s*${key}\\s*=`).test(l));
  if (i < 0) i = lines.findIndex((l) => new RegExp(`^\\s*#\\s*${key}\\s*=`).test(l));
  if (i >= 0) lines[i] = line;
  else {
    if (lines.length && lines[lines.length - 1] === '') lines.pop();
    lines.push(line, '');
  }
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, lines.join(eol));
  fs.renameSync(tmp, file);
}

// Every key in .env.example and .env, and whether it has a value. Values are never returned:
// even the ones that are not secret, like an email address or a phone number, are private.
function listKeys(file = ENV, example = EXAMPLE) {
  const read = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '');
  const keys = new Map();
  for (const m of read(example).matchAll(/^\s*#?\s*([A-Z][A-Z0-9_]*)\s*=/gm)) keys.set(m[1], { key: m[1], set: false });
  const values = fs.existsSync(file) ? require('util').parseEnv(read(file)) : {};
  for (const [k, v] of Object.entries(values)) {
    keys.set(k, { key: k, set: v !== '' });
  }
  return [...keys.values()].map((k) => ({ ...k, secret: isSecret(k.key) }));
}

// Reads one line from the terminal without showing it: each character shows as *.
function readHidden(prompt, { input = process.stdin, output = process.stdout } = {}) {
  return new Promise((resolve, reject) => {
    if (!input.isTTY) {
      reject(new Error('Secret keys can only be typed in your own terminal. Open a terminal yourself and run this command there.'));
      return;
    }
    output.write(prompt);
    let value = '';
    input.setRawMode(true);
    input.resume();
    input.setEncoding('utf8');
    const done = (err) => {
      input.setRawMode(false);
      input.pause();
      input.removeListener('data', onData);
      output.write('\n');
      if (err) reject(err); else resolve(value);
    };
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') return done();
        if (ch === '\u0003') return done(new Error('Cancelled. Nothing was saved.'));
        if (ch === '\u007f' || ch === '\b') {
          if (value) { value = value.slice(0, -1); output.write('\b \b'); }
        } else if (ch >= ' ') {
          value += ch;
          output.write('*');
        }
      }
    };
    input.on('data', onData);
  });
}

module.exports = { setKey, listKeys, ensureEnv, isSecret, format, readHidden, ENV };
