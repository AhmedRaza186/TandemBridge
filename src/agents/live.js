// A readable, growing log of what an agent is doing right now. The Antigravity extension shows it
// live in the project's IDE window, because the IDE's own agent panel cannot follow a conversation
// that a CLI runs: the CLI keeps its conversations in a separate store.
//
// Line format, read by extensions/antigravity/view.js:
//   TandemBridge step: <title>      By: <agent> · <model>      Started: <ISO time>      Folder: <path>
//   Agent: <text>   (until a blank line)     > <tool>  <what>     x <tool> failed: <why>
//   ~ tokens <n>    Finished: <status>, <secs>s, <n> tokens[, $<cost>]     [end]
const fs = require('fs');
const os = require('os');
const path = require('path');

const KEEP_MS = 3 * 24 * 60 * 60 * 1000;
const one = (s, n) => String(s).replace(/\s+/g, ' ').slice(0, n);

function cleanOld(dir, now = Date.now()) {
  try {
    for (const f of fs.readdirSync(dir)) {
      const file = path.join(dir, f);
      if (f.endsWith('.log') && now - fs.statSync(file).mtimeMs > KEEP_MS) fs.rmSync(file, { force: true });
    }
  } catch (e) { /* nothing to clean */ }
}

const relative = (file, workspace) => {
  const rel = path.relative(workspace, String(file));
  return rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? rel.replace(/\\/g, '/') : String(file);
};

// The part of an agy tool call worth showing: the file, the command, or the search.
function describe(info, workspace) {
  const p = (info && info.parameters) || {};
  const file = p.Path || p.AbsolutePath || p.TargetFile || p.FilePath || p.DirectoryPath || p.SearchPath;
  if (file) return relative(file, workspace);
  const text = p.CommandLine || p.Command || p.Query || p.Pattern || p.Url;
  return text ? one(text, 200) : '';
}

// The same for a Claude Code tool call.
function describeClaude(input, workspace) {
  const p = input || {};
  const file = p.file_path || p.notebook_path || p.path;
  const text = p.command || p.pattern || p.query || p.url || p.description;
  if (p.pattern && file) return `${one(p.pattern, 120)} in ${relative(file, workspace)}`;
  if (file) return relative(file, workspace);
  return text ? one(text, 200) : '';
}

function createLiveLog(dir, name, { title, workspace, agent, model }) {
  fs.mkdirSync(dir, { recursive: true });
  cleanOld(dir);
  const file = path.join(dir, `${name}.log`);
  const write = (text) => { try { fs.appendFileSync(file, text); } catch (e) { /* the log is only for watching */ } };
  write(`TandemBridge step: ${title}\n${agent ? `By: ${agent}${model ? ` · ${model}` : ''}\n` : ''}`
    + `Started: ${new Date().toISOString()}\nFolder: ${workspace}\n${'-'.repeat(60)}\n`);

  const shown = new Set();
  let speaking = false;
  let lastTokens = 0;
  const endSpeech = () => { if (speaking) { write('\n\n'); speaking = false; } };

  const log = {
    file,
    say(text) {
      if (!text) return;
      if (!speaking) write('Agent: ');
      speaking = true;
      write(text);
    },
    endSay: endSpeech,
    tool(name, what) { endSpeech(); write(`> ${name}${what ? `  ${what}` : ''}\n`); },
    fail(name, why) { endSpeech(); write(`x ${name} failed${why ? `: ${one(why, 300)}` : ''}\n`); },
    tokens(n) {
      if (!n || n === lastTokens) return;
      lastTokens = n;
      endSpeech();
      write(`~ tokens ${n}\n`);
    },
    finish({ status, seconds, tokens, cost }) {
      endSpeech();
      write(`${'-'.repeat(60)}\nFinished: ${status || 'unknown'}${seconds ? `, ${Math.round(seconds)}s` : ''}`
        + `${tokens ? `, ${tokens} tokens` : ''}${cost ? `, $${cost.toFixed(2)}` : ''}\n`);
    },
    // One stream-json event from agy.
    event(e) {
      const u = e.step_update;
      if (u && u.step_type === 'agent_response') {
        log.say(u.text_delta);
        if (u.state === 'DONE') endSpeech();
      } else if (u && u.step_type === 'tool') {
        const key = `${u.step_index}`;
        if ((u.state === 'ACTIVE' || u.state === 'DONE') && !shown.has(key)) {
          shown.add(key);
          log.tool(u.tool_name, describe(u.tool_info, workspace));
        } else if (u.state === 'ERROR') {
          log.fail(u.tool_name, u.tool_info && u.tool_info.error && u.tool_info.error.message);
        }
      } else if (e.event === 'result' && e.result) {
        const r = e.result;
        log.finish({ status: r.status, seconds: r.duration_seconds, tokens: r.usage && r.usage.total_tokens });
      }
    },
    // Written once the run is over, whatever happened, so the viewer knows to stop.
    end(note) { endSpeech(); write(`${note ? `${note}\n` : ''}[end]\n`); }
  };
  return log;
}

// Reads Claude Code's stream-json events into a live log, and keeps the running token count.
function claudeReader(live, workspace) {
  const seen = new Map();          // message id -> tokens, since one message arrives in several events
  const total = () => [...seen.values()].reduce((a, b) => a + b, 0);
  return (e) => {
    if (e.type === 'assistant' && e.message) {
      for (const c of e.message.content || []) {
        if (c.type === 'text') { live.say(c.text); live.endSay(); }
        else if (c.type === 'tool_use') live.tool(c.name, describeClaude(c.input, workspace));
      }
      const u = e.message.usage;
      if (u && e.message.id) {
        seen.set(e.message.id, (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0)
          + (u.cache_read_input_tokens || 0) + (u.output_tokens || 0));
        live.tokens(total());
      }
    } else if (e.type === 'user' && e.message && Array.isArray(e.message.content)) {
      for (const c of e.message.content) {
        if (c.type === 'tool_result' && c.is_error) {
          const text = Array.isArray(c.content) ? c.content.map((x) => x.text || '').join(' ') : c.content;
          live.fail('tool', text);
        }
      }
    } else if (e.type === 'result') {
      live.finish({ status: e.is_error ? (e.subtype || 'error') : 'success', seconds: e.duration_ms / 1000, tokens: total(), cost: e.total_cost_usd });
    }
  };
}

const tandemDir = () => path.join(os.homedir(), '.tandembridge');

// Every Antigravity window's extension watches this one file to find the live log for its own
// project. A link to the window would be simpler, but the IDE sends a link to whichever window was
// last active, and a window that is still starting has not loaded the extension yet.
const indexFile = () => process.env.TANDEMBRIDGE_LIVE_INDEX || path.join(tandemDir(), 'live.json');
const limitsFile = () => process.env.TANDEMBRIDGE_LIMITS_FILE || path.join(tandemDir(), 'limits.json');
const key = (workspace) => path.resolve(workspace).toLowerCase();

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')); } catch (e) { return {}; }
}

function writeJson(file, value) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(value, null, 1));
    fs.renameSync(tmp, file);                  // the extension never reads a half-written file
  } catch (e) { /* watching is optional */ }
}

function announceLive(workspace, file, now = Date.now()) {
  const entries = readJson(indexFile());
  for (const [k, v] of Object.entries(entries)) if (now - v.started > KEEP_MS) delete entries[k];
  entries[key(workspace)] = { log: file, started: now };
  writeJson(indexFile(), entries);
}

// Claude Code reports how much of the plan's 5-hour and weekly limits is used, with every run.
// Kept so the panel can show what is left, even between runs.
function saveClaudeLimits(info, now = Date.now()) {
  const w = info && info.unifiedWindows;
  if (!w) return;
  // A fraction from 0 to 1; read anything above 1 as a percentage.
  const pick = (x) => x && typeof x.utilization === 'number' ? { used: x.utilization > 1 ? x.utilization / 100 : x.utilization, resetsAt: x.resetsAt * 1000, status: x.status } : null;
  const all = readJson(limitsFile());
  all.claude = { fiveHour: pick(w.five_hour), week: pick(w.seven_day), updated: now };
  writeJson(limitsFile(), all);
}

module.exports = { createLiveLog, claudeReader, describe, describeClaude, cleanOld, announceLive, saveClaudeLimits, indexFile, limitsFile };
