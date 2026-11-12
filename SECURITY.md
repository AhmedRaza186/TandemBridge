# Security

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting on this repository. Do not open a public issue.

## What to know before running this

This tool runs AI coding agents on your machine without asking you before each action.

- Agents are limited to a list of commands and to the folders of their step, and the orchestrator
  checks every change with `git diff`. Those limits guard against accidents. They are not a security
  boundary, because `npm`, `npx`, and `node` can run any script.
- Only build projects you trust, and do not run it on a machine holding data you cannot afford to
  expose.
- The orchestrator commits to a local branch. It never pushes or deploys.

## Secrets

Secrets belong only in `.env`, which is ignored by git. `/setup` never asks for them in chat.
