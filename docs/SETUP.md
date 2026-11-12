# Setup

Instructions for the AI agent that sets TandemBridge up. Any coding agent that can run terminal
commands can follow them: Claude Code, Codex, GitHub Copilot, Antigravity, Gemini CLI, Cursor, or
another. The owner opens their agent in this folder and asks it to follow `docs/SETUP.md`.

Set this project up for its owner by interviewing them. Everything below is decided by the owner,
not assumed.

Rules for the whole interview:

- First question: which language they want to talk in. Use that language for every later question
  and for your final message.
- Ask in small groups, with a recommended option first. Use your question tool if you have one,
  otherwise ask in chat with numbered options. Every question also accepts a free-text answer.
- **Never ask for a password, token, or API key in chat.** The owner types each secret into their
  own terminal with `npm run bridge -- set-key <NAME>`, which hides it as they type and saves it in
  `.env`. Never run that command for a secret yourself, and never open or print `.env`.
- If `bridge.profile.json` or `AGENTS.md` already exists, show what is there and ask before
  replacing it. Never overwrite an existing `.env`; only add missing keys to it.

## 1. Check the machine

Run `node -v` (22 or newer is required) and `git --version`. Stop and explain if either is missing.

Run `npm install` and `npm run migrate`, then `npm run bridge -- agents`. It lists every agent the
orchestrator can run, whether it is installed, and how to log in to it.

## 2. Interview

**About them:** their name, and the language for alerts and for the manager's replies. Any language
is allowed. Ask for the name as a free-text answer with no suggested names. Never take it from this
repository: the name in `LICENSE`, the README, or the git history is the author of TandemBridge,
not the person setting it up.

**Who does what.**

- **Manager**, who talks to the owner, plans, and follows the work: any agent they like to chat
  with, as long as it can run terminal commands in this folder. Ask which one they use. Common
  choices are Codex, Claude Code, GitHub Copilot (agent mode in VS Code, or the Copilot CLI),
  Antigravity, Gemini CLI, and Cursor. It does not have to be one found in step 1, since it may be
  an IDE or desktop app.
- **Backend, frontend, and reviewer**: any agent from the `agents` list, in any mix. One agent
  may do every job. Ask which AI subscriptions or free accounts they already have, and suggest from
  those:

  | Agent | Cost | Notes |
  |---|---|---|
  | `claude` (Claude Code) | Claude plan or API | Strongest for backend and review |
  | `antigravity` | Free tier | Good for frontend; can watch it work in the IDE |
  | `codex` | ChatGPT plan | Has its own sandbox that keeps writes inside the project |
  | `copilot` (GitHub Copilot CLI) | GitHub Copilot plan | |
  | `gemini` (Gemini CLI) | Free with a Google login | Good free choice for any job |

  When both exist, recommend Claude for backend and review and Antigravity for frontend. For
  someone who wants to spend nothing, Gemini CLI or Antigravity for everything.

**Install what they picked.** For each chosen agent the `agents` list shows as not installed, ask
before installing anything. With a yes, run `npm run bridge -- agent-install <agent>`; Antigravity
has no npm package, so give them its download link instead. Then tell them how to log in (the
`agents` list says how) and wait until they say it is done. Logging in happens in their own
terminal or browser: never ask for a password or token in chat. Run `npm run bridge -- agents`
again and confirm every chosen agent shows as installed.

Ask whether they want to watch steps in their IDE (Antigravity or VS Code). If yes, run
`npm run bridge -- extension-install`, then ask them to reload every open IDE window. The
"TandemBridge" side panel (its icon is in the activity bar) shows each step live; they can drag it
to the right side bar once. A terminal window that shows each step live also opens by itself when
a step starts; `WATCH_WINDOW=off` in `.env` turns it off.

**Alerts.** First test whether Telegram works on their network, with a 10-second request to
`https://api.telegram.org`. It is blocked in some countries, including Pakistan. They may turn on
any mix of these channels:

- **ntfy:** free phone push through the ntfy app, with no account or key. Recommend it by default.
  Run `npm run bridge -- ntfy-topic` to make their private topic, and tell them to subscribe to it
  in the app. Explain that anyone who learns the topic name can read their alerts.
- **Telegram:** free and official, with instant phone notifications. Offer it only if the
  request above succeeded. Otherwise say it appears blocked on their network.
- **WhatsApp through CallMeBot:** free, to their own number only. It is an unofficial third-party
  service: alert text passes through its servers, its limits are unpublished, it sometimes stops
  taking new sign-ups, and it can stop without notice.
- **Email:** free and reliable, but easy to miss. For a Gmail sender, explain 2-Step Verification
  and an App Password, and ask only for the sending and receiving addresses.
- **WhatsApp Cloud API:** official, but needs a Meta app, a number, and an approved template with
  one variable, and Meta charges per message.

Set `CHANNEL_EMAIL`, `CHANNEL_NTFY`, `CHANNEL_WHATSAPP`, `CHANNEL_TELEGRAM`, and `CHANNEL_CALLMEBOT` to `on` or `off`
to match. For a phone number used by CallMeBot, ask for it with the country code.

**Backups (optional).** Ask whether they want automatic copies of TandemBridge's own database
(workflows, steps, alerts). If yes, ask for a folder. Recommend a OneDrive or Google Drive folder
so a copy lives off the machine, and mention that the copies hold their project plans and alert
text. Set `BACKUP_DIR`, and `BACKUP_EVERY_HOURS` and `BACKUP_KEEP` if they want other than 6 hours
and 14 copies. Then run `npm run bridge -- backup` once to check it works.

**How much the manager decides alone.** Offer:

- Technical review fixes only, and ask the owner about product decisions (recommended).
- Ask the owner about everything.
- Decide everything except cancelling work or spending more budget.

**Token usage.** Explain that every step costs tokens from their own plan, and that a Claude Pro
plan runs out quickly on long builds. Ask which plan they use for each chosen agent, then offer a
level for `limits.usage`:

Every Claude step runs on Opus 5.5 at medium effort. The level sets the guards:

| Level | Guard per step / workflow | For |
|---|---|---|
| `saver` | $3 / $15 | Claude Pro, or keeping the plan for other work |
| `balanced` | $6 / $30 | Claude Max 5x, most people (recommended) |
| `max` | $12 / $60 | Claude Max 20x or the API, the hardest projects |

The guards are usage measured at API prices. On a Pro or Max plan they are not a bill, but they are
what stops one project from using up the whole plan. Mention that they get an alert at 80% of the
guard and the workflow pauses at 100%, and that a plan's own limit pauses the step and retries it
by itself later. Other agents (Codex, Copilot, Gemini, Antigravity) report no cost, so for them
only their plan's own limits apply.

**Limits and instructions.** Review rounds (default 2), a different guard if they want one, and
anything they always want followed, such as a preferred stack, coding rules, or things never to do.

## 3. Write the files

**`bridge.profile.json`:**

```json
{
  "owner": "their name",
  "language": "their language",
  "team": { "manager": "their manager, for example copilot", "backend": "claude", "frontend": "antigravity", "reviewer": "claude" },
  "limits": { "usage": "balanced", "maxReviewRounds": 2 },
  "messages": {}
}
```

If the language is not English, run `npm run bridge -- messages` and put a translation of every
entry in `messages`, in the same keys. Keep `{placeholders}`, `npm run` commands, and the literal
phrases "fix them" and "accept as is" exactly as they are.

**`.env`:** never edit it by hand and never ask the owner to. Put each setting that is not a secret
in with `npm run bridge -- set-key <NAME> <value>`, for example
`npm run bridge -- set-key CHANNEL_NTFY on` or `npm run bridge -- set-key EMAIL_TO them@example.com`.
The first one creates `.env` from `.env.example`. Leave every secret for the owner (see section 4).
`npm run bridge -- keys` shows which settings have a value, without showing any value.

**`AGENTS.md`:** copy `templates/AGENTS.template.md` and replace:

- `{{owner}}` and `{{language}}`.
- `{{team_table}}`: a table of who does which job, with the owner on the first row.
- `{{escalation_rules}}`: state plainly what the manager may answer alone and what must go to the
  owner, from their answer above. `cancel` and `resume --budget` always go to the owner unless they
  said otherwise.
- `{{standing_instructions}}`: a `## Standing instructions` section with their rules, or nothing.

Then make sure the manager actually reads `AGENTS.md`. Each tool looks for its own file:

| Manager | What to do |
|---|---|
| Codex, Antigravity, Cursor | Nothing, they read `AGENTS.md` |
| Claude Code | Create `CLAUDE.md` with the single line `@AGENTS.md` |
| Gemini CLI | Create `GEMINI.md` with the single line `@AGENTS.md` |
| GitHub Copilot | Create `.github/copilot-instructions.md` with: "Read AGENTS.md in the repository root before anything else, and follow it." Also tell them to turn on the `chat.useAgentsMdFile` setting in VS Code |
| Anything else | Find out from the tool's docs which instructions file it reads, and point it at `AGENTS.md` the same way |

All of these files are ignored by git, so they stay on this machine. Only create the one for the
manager they chose.

The `plan` command uses Codex. Without Codex the manager plans by itself: it runs
`npm run bridge -- planner-prompt` and writes the spec, as `AGENTS.md` already tells it.

## 4. Verify

- Run `npm test` and report any failure.
- If any alert channel needs a secret, tell the owner how to get it, then give them the exact
  command to type in **their own terminal** (not yours: a secret can only be typed where they can
  see the prompt), one per secret, for example:

  ```text
  npm run bridge -- set-key SMTP_APP_PASSWORD
  ```

  It asks for the value, shows only `*` while they paste it, and saves it in `.env`. The secrets
  are `SMTP_APP_PASSWORD` (Gmail App Password), `TELEGRAM_BOT_TOKEN` (from @BotFather),
  `CALLMEBOT_APIKEY` (from callmebot.com, whose current WhatsApp instructions you should send them
  to, because its bot number changes), `WHATSAPP_TOKEN`, and `NTFY_TOKEN` (only for a reserved
  topic or their own server). For Telegram, after the token: they message the bot once, you run
  `npm run bridge -- telegram-chat-id` and save the result with `set-key TELEGRAM_CHAT_ID <id>`.
- Wait until they say it is done, check with `npm run bridge -- keys`, then run
  `npm run bridge -- notify-test` and ask them to confirm the message arrived on their phone.

## 5. Finish

Tell the owner, in their language, how to start:

1. In one terminal, keep `npm run bridge -- run` open.
2. Open the manager agent in this folder and describe what they want built.
3. Use `npm run bridge -- references` to see the UI styles, and `reference-add` for a site they like.
