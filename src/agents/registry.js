// Every agent the orchestrator can hand a step to: how to install it, log in, and run it.
// Adding an agent means adding an entry here and an executor.
const { createClaudeExecutor, createAntigravityExecutor } = require('./executors');
const { createCodexExecutor, createCopilotExecutor, createGeminiExecutor } = require('./cli-executors');

const AGENTS = {
  claude: {
    name: 'Claude Code', bin: (c) => c.claudeBin, npm: '@anthropic-ai/claude-code',
    login: 'claude', loginHelp: 'run "claude" once and sign in', instructionsFile: 'CLAUDE.md',
    create: (config) => createClaudeExecutor(config)
  },
  antigravity: {
    name: 'Antigravity', bin: (c) => c.agyBin, npm: null, url: 'https://antigravity.google/download',
    login: 'agy', loginHelp: 'open Antigravity once and sign in with Google',
    create: (config, opts) => createAntigravityExecutor(config, opts)
  },
  codex: {
    name: 'Codex', bin: (c) => c.codexBin, npm: '@openai/codex',
    login: 'codex login', loginHelp: 'run "codex login" and sign in with ChatGPT',
    create: (config) => createCodexExecutor(config)
  },
  copilot: {
    name: 'GitHub Copilot', bin: (c) => c.copilotBin, npm: '@github/copilot',
    login: 'copilot login', loginHelp: 'run "copilot login" and sign in with GitHub (needs a GitHub Copilot plan)',
    create: (config) => createCopilotExecutor(config)
  },
  gemini: {
    name: 'Gemini CLI', bin: (c) => c.geminiBin, npm: '@google/gemini-cli',
    login: 'gemini', loginHelp: 'run "gemini" once and choose Sign in with Google (free tier)', instructionsFile: 'GEMINI.md',
    create: (config) => createGeminiExecutor(config)
  }
};

const AGENT_IDS = Object.keys(AGENTS);
const agentName = (id) => (AGENTS[id] ? AGENTS[id].name : id);

function createExecutors(config, opts) {
  return Object.fromEntries(AGENT_IDS.map((id) => [id, AGENTS[id].create(config, opts)]));
}

module.exports = { AGENTS, AGENT_IDS, agentName, createExecutors };
