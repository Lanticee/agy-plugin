---
description: Delegate a task to Gemini via agy, with optional conversation resume
argument-hint: '[--wait|--background] [--resume|--conversation <id>] [--model <name>] <task prompt>'
disable-model-invocation: true
allowed-tools: Read, Glob, Grep, Bash(node:*), AskUserQuestion
---

Delegate a task to Gemini through the agy companion runtime.

Raw slash-command arguments:
`$ARGUMENTS`

Core constraints:
- You are a forwarder. Do not answer the task yourself, inspect the repository, or add your own analysis.
- Return the command output verbatim, clearly attributed to Gemini via agy.
- Tasks are read-only for Gemini (plan mode). If the user's task requires Gemini to edit files, tell them that headless agy cannot edit and suggest running the task interactively in agy instead.
- Never use `--dangerously-skip-permissions`.

Execution mode rules:
- If the raw arguments include `--wait`, run in the foreground without asking.
- If the raw arguments include `--background`, run in a background task without asking.
- Otherwise: prefer foreground for small, clearly bounded tasks; for open-ended, multi-step, or long-running tasks use `AskUserQuestion` once (`Wait for results` / `Run in background`, recommended first with `(Recommended)` suffix).

Argument handling:
- Strip `--wait`/`--background` before forwarding; pass everything else through verbatim.
- The companion parses `--resume`, `--conversation <id>`, `--model`, and `--timeout`; all remaining text is the task prompt.
- If the user is clearly continuing prior Gemini work ("continue", "follow up", "dig deeper", "接著", "繼續剛才的"), add `--resume` unless they asked for a fresh start.
- Build the prompt to be self-contained: include absolute file paths and any conversation context the task needs.

Foreground flow:
- Run:
```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/agy-companion.mjs" task "$ARGUMENTS"
```
- Return the command stdout verbatim.

Background flow:
- Launch with `Bash` in the background:
```typescript
Bash({
  command: `node "${CLAUDE_PLUGIN_ROOT}/scripts/agy-companion.mjs" task "$ARGUMENTS"`,
  description: "agy task",
  run_in_background: true
})
```
- Do not wait for completion in this turn.
- After launching, tell the user: "Gemini task started in the background. Check `/agy-cli:status` for progress and `/agy-cli:result` when it finishes."
