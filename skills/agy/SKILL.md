---
name: agy
description: Delegate a task to the Antigravity CLI (agy) running a Gemini model. Use when the user asks to consult Gemini / Antigravity / agy for a second opinion, analysis, or to offload a subtask.
argument-hint: <prompt for agy>
allowed-tools: [Bash, Read, Glob, Grep]
---

# Delegate to Antigravity CLI (agy)

Forward the user's request to Gemini through the agy companion runtime, which handles the headless-agy pitfalls (stdin hang, argv limits, plan-mode file reading) and records every run as a resumable job.

## How to invoke

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/agy-companion.mjs" task "<task text> [--resume] [--model <name>]"
```

Notes:
- Build a self-contained prompt from $ARGUMENTS: include absolute file paths and any context the user referenced. Gemini runs in plan mode (read-only tools auto-approved) and reads workspace files itself.
- To continue Gemini's previous conversation in this repo, add `--resume` (or `--conversation <id>` for a specific one — IDs are shown by `/agy-cli:result`).
- `--model` accepts the quoted display name (`"Gemini 3.6 Flash (Medium)"`, `"Gemini 3.1 Pro (Low)"`) or the short id from `agy models`. Default is Gemini 3.6 Flash (Medium).
- For long tasks add `--timeout 20m` (companion default is 10m).
- Tasks are read-only for Gemini: headless agy cannot answer edit/command permission prompts, and this plugin never uses `--dangerously-skip-permissions`. If the task needs edits, keep it as analysis or suggest running agy interactively.
- Related commands: `/agy-cli:status`, `/agy-cli:result`, `/agy-cli:cancel` for background jobs; `/agy-cli:review` for code review.

## Steps

1. Build the self-contained task text (file paths + context) from $ARGUMENTS.
2. Run the companion `task` command above via Bash.
3. Relay the output back to the user verbatim, clearly attributed to Antigravity/Gemini, and add your own assessment only if you disagree or can verify a claim.
4. If the run fails with quota/rate-limit errors, empty output, or repeated timeouts, tell the user and stop dispatching to agy for the rest of the session — one quota-type failure means later calls will fail too.
