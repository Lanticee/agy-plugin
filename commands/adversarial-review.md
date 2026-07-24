---
description: Run a steerable adversarial Gemini review (via agy) that challenges the design, not just the code
argument-hint: '[--wait|--background] [--base <ref>] [--scope auto|working-tree|branch] [--model <name>] [focus text]'
disable-model-invocation: true
allowed-tools: Read, Glob, Grep, Bash(node:*), Bash(git:*), AskUserQuestion
---

Run an adversarial Gemini review through the agy companion runtime.

Raw slash-command arguments:
`$ARGUMENTS`

Core constraints:
- This command is review-only. Do not fix issues, apply patches, or offer to make changes.
- Your only job is to run the review and return the command output verbatim to the user.
- Never use `--dangerously-skip-permissions`.

Execution mode rules:
- If the raw arguments include `--wait`, do not ask. Run in the foreground.
- If the raw arguments include `--background`, do not ask. Run in a background task.
- Otherwise, estimate the review size (same git checks as `/agy-cli:review`), recommend waiting only for tiny reviews, then use `AskUserQuestion` exactly once: `Wait for results` / `Run in background`, recommended first with `(Recommended)` suffix.

Argument handling:
- Strip `--wait`/`--background` before forwarding; pass everything else — including free-form focus text — through to the companion verbatim.
- The companion parses `--base`, `--scope`, `--model`, and `--timeout`; any remaining text becomes the review focus.

Foreground flow:
- Run:
```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/agy-companion.mjs" adversarial-review "$ARGUMENTS"
```
- Return the command stdout verbatim, exactly as-is. Do not paraphrase, summarize, or add commentary.

Background flow:
- Launch with `Bash` in the background:
```typescript
Bash({
  command: `node "${CLAUDE_PLUGIN_ROOT}/scripts/agy-companion.mjs" adversarial-review "$ARGUMENTS"`,
  description: "agy adversarial review",
  run_in_background: true
})
```
- Do not wait for completion in this turn.
- After launching, tell the user: "Gemini adversarial review started in the background. Check `/agy-cli:status` for progress and `/agy-cli:result` when it finishes."
