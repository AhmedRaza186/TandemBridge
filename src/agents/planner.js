// Turns an idea into a workflow spec using Codex on the ChatGPT login.
// Read-only sandbox and no MCP servers: the planner can only produce text.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { runCli } = require('./executors');
const { validateSpec } = require('../core/workflow');
const { referenceRules } = require('../core/references');
const { loadProfile } = require('../config/profile');

function rules() {
  const { backend, frontend, reviewer } = loadProfile().team;
  const jobs = { [backend]: [], [frontend]: [], [reviewer]: [] };
  jobs[backend].push('backend, database, API, tests, integration');
  jobs[frontend].push('frontend UI');
  jobs[reviewer].push('code review');
  const team = Object.entries(jobs).map(([agent, list]) => `- ${agent}: ${list.join(', ')}.`).join('\n');
  return `You are the planning brain of a small software team. Turn the request into a workflow spec.

Team:
${team}

Rules:
- Step 1 is ${backend} writing docs/API_CONTRACT.md, the single source of truth both sides follow, with every endpoint, payload, and error.
- Then ${backend} builds the backend, then ${frontend} builds the frontend against the contract.
- The orchestrator adds docs/BACKEND.md to the project: the backend structure and security rules. Backend goals say "follow docs/BACKEND.md" and only spell out where this project differs (its database, whether it has logins). Never put docs/BACKEND.md in a scope.
- The last step is a ${reviewer} "review" step that checks both sides work together. It finds problems and sends fixes back.
- Scopes never overlap between agents, except that the final review step has an empty scope [] (read-only).
- scope entries are relative paths with forward slashes: a folder ending in "/" or one exact file. No wildcards. Root files such as README.md or .gitignore need their own entry.
- Every implement step has acceptance criteria that can be checked.
- Every implement step that creates a folder adds typecheck, lint, test, and build scripts there, and its verify list runs all of them. Later steps for that folder verify the same way.
- verify holds commands the orchestrator runs from the workspace root on Windows. They must finish by themselves and need no network service running. Never start a dev server there. Install with "cd backend && npm install" (never "npm --prefix backend install", which does not work); other scripts may use "npm --prefix backend test".
- Keep the plan small, because every step starts fresh and spends tokens reading the project again: a typical app is 4 to 7 steps, one per real piece of work (contract, backend, frontend, review). Never split a piece into tiny steps, and have exactly one review step.
- Use depends_on so that each step runs only after what it needs. It may reference earlier steps only.
- Goals are specific enough that an engineer who never saw this request could do the work. Agents get the goal text, the contract, and earlier summaries.
- Put a question in "questions" only if a wrong guess would waste the whole build. Otherwise choose a sensible default and say so in the goal.
- run_instructions tells the owner how to start the finished app.
- Deliver a complete, properly built application: validation, error handling, tests, and a finished UI. Stay within what the request asks for.`;
}

// Returns true when the error means "try the next model", not a real failure.
const { modelRejected } = require('./cli-executors');

async function plan({ idea, workspace, answers, config, exec = runCli }) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-plan-'));
  const outFile = path.join(tmp, 'spec.json');
  const schema = path.join(__dirname, '..', '..', 'schemas', 'workflow-spec.schema.json');
  const prompt = [rules(), '', referenceRules(), '', `Request:\n${idea}`, answers ? `\nThe owner answered your questions:\n${answers}` : ''].join('\n');

  try {
    let lastError = '';
    for (const model of config.plannerModels) {
      const args = ['exec', '--skip-git-repo-check', '--sandbox', 'read-only', '-m', model,
        '-c', 'mcp_servers={}', '--output-schema', schema, '-o', outFile, '-C', tmp];
      const r = await exec(config.codexBin, args, { cwd: tmp, input: prompt, timeoutMs: config.plannerTimeoutMs }).done;
      const text = `${r.out}\n${r.err}`;
      if (r.code !== 0) {
        lastError = text.slice(-800);
        if (modelRejected(text)) continue;
        throw new Error(`codex failed: ${lastError}`);
      }
      const spec = JSON.parse(fs.readFileSync(outFile, 'utf8'));
      spec.workspace = workspace;
      return { spec, model, problems: validateSpec(spec) };
    }
    throw new Error(`no planner model is available on this account: ${lastError}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

module.exports = { plan, modelRejected, rules };
