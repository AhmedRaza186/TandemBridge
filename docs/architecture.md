# Architecture

TandemBridge turns one project description into a finished app by passing work between AI coding
agents. A long-running orchestrator holds all state in SQLite, so a crash or a restart loses nothing.

```text
Owner -> Manager -> workflow spec -> Orchestrator
                                       |-- backend agent:  API contract, backend
                                       |-- frontend agent: UI, following the contract
                                       `-- reviewer:       checks both, sends fixes back
```

## Repository layout

| Path | Contents |
|---|---|
| `bin/` | Command line entry point |
| `src/cli/` | The `bridge` commands |
| `src/core/` | Scheduler, workflows, git guards, UI references, battery and sleep handling |
| `src/agents/` | How each agent CLI is run, and the planner |
| `src/notifications/` | Outbox for email, ntfy, WhatsApp, Telegram, and CallMeBot, and alert text |
| `src/config/` | Settings and the owner's profile |
| `src/db/` | SQLite connection and migrations |
| `schemas/` | JSON schema of a workflow spec |
| `references/` | UI style packs for the frontend agent |
| `templates/` | Files that `/setup` fills in |
| `extensions/antigravity/` | IDE side panel (Antigravity and VS Code) that shows each step live, with the Claude plan limits |
| `.claude/skills/setup/` | The `/setup` interview |
| `data/` | Runtime database, logs, and specs. Never committed |
| `test/` | Test suite |

## How a step runs

1. The scheduler claims the next ready step and builds its prompt.
2. The agent runs with a limited set of commands, in the project's workspace.
3. As its last action, the agent writes `.bridge/result-<id>.json`. A step can finish, ask a
   question, or, for a review, send fixes back.
4. The orchestrator compares `git diff` against the step's allowed paths, runs its `verify`
   commands, and commits to the workflow's own branch.
5. The next step starts, or the owner gets an alert.

## Failure handling

| Failure | Response |
|---|---|
| Agent error, failed check, or missing result file | Retries twice, with the error as feedback |
| Quota | Retries every 30 minutes |
| Network | Retries after 5 minutes |
| Machine off or crash | The interrupted step restarts when the orchestrator does |
| Expired login | Waits for `resume` |
| Still failing after retries | Workflow fails and alerts the owner; `retry` continues it |

## Configuration

| File | Purpose | Committed |
|---|---|---|
| `.env` | Alert settings and secrets | No |
| `bridge.profile.json` | Team roles, limits, alert language | No |
| `AGENTS.md` | The manager's instructions | No, generated from `templates/` |

`TANDEMBRIDGE_DB`, `TANDEMBRIDGE_LOG`, and `TANDEMBRIDGE_PID` override the default paths in `data/`.
