---
description: Run a Gemini code review (via agy) against local git state
argument-hint: '[--wait|--background] [--base <ref>] [--scope auto|working-tree|branch] [--model <name>]'
disable-model-invocation: true
allowed-tools: Read, Glob, Grep, Bash(node:*), Bash(git:*), AskUserQuestion
---

Run a Gemini code review through the agy companion runtime.

Raw slash-command arguments:
`$ARGUMENTS`

Core constraints:
- This command is review-only. Do not fix issues, apply patches, or offer to make changes.
- Your only job is to run the review and return the command output verbatim to the user.
- Never use `--dangerously-skip-permissions`.

Execution mode rules:
- If the raw arguments include `--wait`, do not ask. Run the review in the foreground.
- If the raw arguments include `--background`, do not ask. Run the review in a background task.
- Otherwise, estimate the review size first:
  - For working-tree review, check `git status --short --untracked-files=all` and `git diff --shortstat` / `git diff --shortstat --cached`.
  - For base-branch review, check `git diff --shortstat <base>...HEAD`.
  - If there is clearly nothing to review, tell the user and stop.
  - Recommend waiting only for tiny reviews (roughly 1-2 files); otherwise recommend background.
  - Then use `AskUserQuestion` exactly once with two options, recommended first with `(Recommended)` suffix: `Wait for results` / `Run in background`.

Argument handling:
- Strip `--wait`/`--background` before forwarding; pass everything else through to the companion verbatim.
- The companion parses `--base`, `--scope`, `--model`, and `--timeout` itself. Do not rewrite them.
- `/agy-cli:review` takes no focus text. For custom focus or adversarial framing, use `/agy-cli:adversarial-review`.

Foreground flow:
- Run:
```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/agy-companion.mjs" review "$ARGUMENTS"
```
- Return the command stdout verbatim, exactly as-is. Do not paraphrase, summarize, or add commentary.

Background flow:
- Launch with `Bash` in the background:
```typescript
Bash({
  command: `node "${CLAUDE_PLUGIN_ROOT}/scripts/agy-companion.mjs" review "$ARGUMENTS"`,
  description: "agy review",
  run_in_background: true
})
```
- Do not wait for completion in this turn.
- After launching, tell the user: "Gemini review started in the background. Check `/agy-cli:status` for progress and `/agy-cli:result` when it finishes."
