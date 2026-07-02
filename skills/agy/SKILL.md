---
name: agy
description: Delegate a task to the Antigravity CLI (agy) running a Gemini model. Use when the user asks to consult Gemini / Antigravity / agy for a second opinion, analysis, or to offload a subtask.
argument-hint: <prompt for agy>
allowed-tools: [Bash, Read, Glob, Grep]
---

# Delegate to Antigravity CLI (agy)

Run the user's request through the Antigravity CLI in non-interactive print mode.

## How to invoke

Use the Bash tool. The default model is Gemini 3.5 Flash; override with the model the user names.

```bash
agy --print "<prompt>" --model gemini-3.5-flash --print-timeout 5m < /dev/null
```

Notes:
- **CRITICAL: always redirect stdin from /dev/null** (`< /dev/null` in bash, `< NUL` via cmd). Without it, agy hangs forever waiting on stdin when run from a non-TTY.
- `--print` runs a single prompt non-interactively and prints the response to stdout.
- agy runs in the current working directory and can read the codebase itself; you usually do NOT need to paste file contents into the prompt — just reference paths.
- If the task needs agy to edit files or run commands, permission prompts cannot be answered in print mode. Ask the user first, then add `--dangerously-skip-permissions` only with their explicit consent. Prefer read-only/analysis tasks otherwise.
- For long tasks raise `--print-timeout` (e.g. `10m`).
- To continue agy's previous conversation add `--continue`.
- List available models with `agy models` if the user asks for a different one.

## Steps

1. Build a self-contained prompt from $ARGUMENTS (add any file paths or context the user referenced in the conversation).
2. Run agy via Bash with the command above. Quote the prompt carefully; for multi-line prompts write it to a temp file and use `agy --print "$(cat <file>)"`.
3. Relay agy's answer back to the user, clearly attributed to Antigravity/Gemini, and add your own assessment if you disagree or can verify it.
