// Executors for agents that have a plain headless CLI: Codex, GitHub Copilot, and Gemini CLI.
// Each one gets the prompt over stdin, so task text never passes through a shell.
const { runCli, classifyFailure } = require('./executors');

const short = (s, n = 500) => (typeof s === 'string' && s.length > n ? s.slice(0, n) + '...' : s);

function outcome(r, { ok, summary, error, sessionId }) {
  const errorText = ok ? '' : [r.timedOut && 'timeout', error, r.err, !error && short(r.out, 400)].filter(Boolean).join(' | ');
  return {
    ok,
    duration_ms: r.ms,
    summary: short(summary),
    cost_usd: 0,
    session_id: sessionId || null,
    error: short(errorText, 600),
    failure: ok ? null : r.timedOut ? 'error' : classifyFailure(errorText)
  };
}

// codex exec --json prints one event per line. A run succeeded when a turn completed and none failed.
function parseCodexRun(r) {
  let summary = '', error = '', completed = false, sessionId = null;
  for (const line of String(r.out).split('\n')) {
    let e;
    try { e = JSON.parse(line); } catch (err) { continue; }
    if (e.type === 'thread.started') sessionId = e.thread_id;
    else if (e.type === 'item.completed' && e.item && e.item.type === 'agent_message') summary = e.item.text || summary;
    else if (e.type === 'turn.completed') completed = true;
    else if (e.type === 'turn.failed') error = (e.error && e.error.message) || 'turn failed';
    else if (e.type === 'error') error = e.message || 'error';
  }
  return outcome(r, { ok: r.code === 0 && completed && !error, summary, error, sessionId });
}

// True when the error means "try the next model", not a real failure.
const modelRejected = (text) => /model is not supported|model .*not (found|available)|does not have access/i.test(text);

// Tries each model in turn, because a ChatGPT login cannot use every model. A rejected model fails
// before any work starts, so trying the next one is safe.
function createCodexExecutor(config, { exec = runCli } = {}) {
  const models = config.codexModel ? [config.codexModel] : (config.plannerModels || []);
  return {
    start(prompt, workspace) {
      let current = null;
      const attempt = async (i) => {
        // workspace-write: Codex's own sandbox keeps writes inside the project (and the temp
        // folder), on Windows too: tested. Network is on so npm install works.
        const args = ['exec', '--json', '--skip-git-repo-check', '--sandbox', 'workspace-write',
          '-c', 'sandbox_workspace_write.network_access=true', '-c', 'mcp_servers={}', '-C', workspace,
          ...(models[i] ? ['-m', models[i]] : [])];
        current = exec(config.codexBin, args, { cwd: workspace, input: prompt, timeoutMs: config.workerTimeoutMs });
        const res = parseCodexRun(await current.done);
        return !res.ok && i + 1 < models.length && modelRejected(res.error) ? attempt(i + 1) : res;
      };
      const done = attempt(0);
      return { kill: () => current && current.kill(), done };
    }
  };
}

// Copilot checks file paths against the working folder by itself. Shell commands are allowed by
// prefix, and the deny list wins over the allow list.
function copilotArgs(config) {
  const args = ['--no-ask-user', '-s', '--trust-folder', '--allow-tool', 'write'];
  for (const c of config.shellAllow) args.push('--allow-tool', `shell(${c}:*)`);
  for (const c of config.shellDeny) args.push('--deny-tool', `shell(${c}:*)`);
  if (config.copilotModel) args.push('--model', config.copilotModel);
  return args;
}

function parseCopilotRun(r) {
  const summary = String(r.out).trim();
  return outcome(r, { ok: r.code === 0 && summary.length > 0, summary, error: r.code === 0 && !summary ? 'no response' : '' });
}

function createCopilotExecutor(config, { exec = runCli } = {}) {
  return {
    start(prompt, workspace) {
      const run = exec(config.copilotBin, copilotArgs(config), { cwd: workspace, input: prompt, timeoutMs: config.workerTimeoutMs });
      return { kill: run.kill, done: run.done.then(parseCopilotRun) };
    }
  };
}

// Gemini CLI appends -p to stdin. In headless mode a tool that would need approval is denied, so
// only file edits and the listed command prefixes can run.
function geminiArgs(config) {
  const args = ['-p', 'Do the task described above, following every rule in it.', '--output-format', 'json',
    '--approval-mode', 'auto_edit', '--skip-trust'];
  for (const c of config.shellAllow) args.push('--allowed-tools', `run_shell_command(${c})`);
  if (config.geminiModel) args.push('-m', config.geminiModel);
  return args;
}

function parseGeminiRun(r) {
  let parsed = null;
  try { parsed = JSON.parse(String(r.out).slice(String(r.out).indexOf('{'))); } catch (e) { /* not JSON */ }
  const error = parsed && parsed.error ? (parsed.error.message || JSON.stringify(parsed.error)) : r.code === 53 ? 'turn limit exceeded' : '';
  return outcome(r, { ok: r.code === 0 && !!parsed && !parsed.error, summary: parsed && parsed.response, error });
}

function createGeminiExecutor(config, { exec = runCli } = {}) {
  return {
    start(prompt, workspace) {
      const run = exec(config.geminiBin, geminiArgs(config), { cwd: workspace, input: prompt, timeoutMs: config.workerTimeoutMs });
      return { kill: run.kill, done: run.done.then(parseGeminiRun) };
    }
  };
}

module.exports = {
  createCodexExecutor, createCopilotExecutor, createGeminiExecutor, modelRejected,
  parseCodexRun, parseCopilotRun, parseGeminiRun, copilotArgs, geminiArgs
};
