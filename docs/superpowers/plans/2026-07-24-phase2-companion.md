# agy Companion Runtime (Phase 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move review execution into a Node.js companion script with per-repo job tracking, enabling `--background` runs plus `/agy-cli:status`, `/agy-cli:result`, `/agy-cli:cancel`.

**Architecture:** `scripts/agy-companion.mjs` dispatches subcommands (`review`, `adversarial-review`, `status`, `result`, `cancel`) over small libs in `scripts/lib/` (args, state, git, prompts, agy, render). Job state lives in JSON files under `CLAUDE_PLUGIN_DATA` (fallback: `os.tmpdir()/agy-companion`), keyed by workspace slug+hash — the same design as openai/codex-plugin-cc's companion. Backgrounding itself is done by Claude Code's `Bash(run_in_background: true)`; the companion always runs synchronously and records progress so `status`/`result`/`cancel` work from other turns. Slash commands become thin wrappers.

**Tech Stack:** Node.js ≥ 18 (ESM, no dependencies), `node --test` for tests, git, Antigravity CLI.

## Global Constraints

- Never use `--dangerously-skip-permissions`.
- agy is spawned with `stdio: ["ignore", ...]` (equivalent to `< /dev/null`) — prevents the non-TTY hang.
- Every agy run: `--mode plan`, `--add-dir <workspace root>`, default model `"Gemini 3.6 Flash (Medium)"`, default `--print-timeout 10m` plus a companion-side kill guard (+60s).
- Tests never invoke real agy: `AGY_COMPANION_AGY_CMD` env (JSON array, e.g. `["node","tests/fake-agy.mjs"]`) overrides the binary.
- Windows-first: binary resolves to `agy.exe` on win32, `agy` elsewhere; process kill uses `taskkill /pid <pid> /t /f` on win32.
- Review commands remain read-only and return agy output verbatim.

## File Structure

- `package.json` — `{ "type": "module", "scripts": { "test": "node --test tests/" } }` (repo tooling only, not part of plugin runtime)
- `scripts/lib/args.mjs` — `splitRawArgumentString(raw)` (quote-aware tokenizer), `parseArgs(argv)` → `{ flags, text }`; boolean flags: `background`, `wait`, `all`, `json`; value flags: `base`, `scope`, `model`, `timeout`
- `scripts/lib/state.mjs` — workspace-keyed state dir; `loadState/saveState/updateState`, `generateJobId`, `upsertJob`, `listJobs`, `writeJobFile/readJobFile`, `resolveJobFile/resolveJobLogFile`; prune to 50 jobs
- `scripts/lib/git.mjs` — `resolveWorkspaceRoot`, `ensureGitRepository`, `detectDefaultBranch`, `getWorkingTreeState`, `resolveReviewTarget(cwd,{base,scope})`, `collectReviewContext(cwd,target)` with 200KB inline-diff cap → self-collect summary mode
- `scripts/lib/prompts.mjs` — `loadTemplate(pluginRoot,name)`, `interpolate(template,vars)` (replaces every `{{KEY}}`)
- `scripts/lib/agy.mjs` — `runAgy({prompt,addDir,model,printTimeout,onSpawn})` → `{status,stdout,stderr,killed}`; `parseDurationMs`; binary override via `AGY_COMPANION_AGY_CMD`
- `scripts/lib/jobs.mjs` — `sortJobsNewestFirst`, `matchJobReference` (id prefix match), `resolveResultJob`, `resolveCancelableJob`, `buildStatusSnapshot`, `killJob`
- `scripts/lib/render.mjs` — `renderStatusReport`, `renderJobResult`, `renderCancelReport`
- `scripts/agy-companion.mjs` — CLI dispatch + the review job lifecycle (create job → run agy → store result → print verbatim)
- `tests/fake-agy.mjs` — canned `## Verdict` output; `FAKE_AGY_EXIT`, `FAKE_AGY_SLEEP_MS` envs
- `tests/args.test.mjs`, `tests/state.test.mjs`, `tests/git.test.mjs`, `tests/runtime.test.mjs`
- Modify: `commands/review.md`, `commands/adversarial-review.md` (thin wrappers, wait/background choice per codex pattern)
- Create: `commands/status.md`, `commands/result.md`, `commands/cancel.md`
- Modify: `README.md`

## Job record shape

```json
{
  "id": "task-<base36>",
  "kind": "review | adversarial-review",
  "status": "running | completed | failed | cancelled",
  "targetLabel": "working tree diff",
  "model": "Gemini 3.6 Flash (Medium)",
  "pid": 123, "agyPid": 456,
  "cwd": "<workspace root>", "logFile": "<jobs dir>/<id>.log",
  "summary": "first Verdict line",
  "createdAt": "...", "updatedAt": "...", "startedAt": "...", "completedAt": "..."
}
```

Full agy stdout/stderr goes in `<jobs dir>/<id>.json` via `writeJobFile`. Finalization reloads the job first: if `status === "cancelled"`, the runner does not overwrite it.

### Task 1: Test scaffold + args lib (TDD)
- [ ] package.json; failing tests for `splitRawArgumentString` (quoted model names) and `parseArgs` (flags vs focus text); implement; `npm test` green; commit.

### Task 2: state lib (TDD)
- [ ] Failing tests (temp `CLAUDE_PLUGIN_DATA`): upsert creates/updates with timestamps, prune keeps 50 newest, job files written/removed; implement (port of codex state.mjs, no config section); green; commit.

### Task 3: git lib (TDD)
- [ ] Failing tests in a scratch git repo: dirty tree → working-tree target; clean tree → branch target vs default branch; `--base` explicit; context contains expected sections; >200KB diff flips to self-collect mode; implement; green; commit.

### Task 4: agy + prompts libs (TDD)
- [ ] Failing tests: interpolate replaces all placeholders; `runAgy` with fake agy returns stdout/exit; kill guard fires on over-time fake; implement; green; commit.

### Task 5: companion main + jobs/render (TDD)
- [ ] Failing runtime tests with fake agy: `review` prints verbatim output and records a completed job; `status` lists it; `result` reprints stored output; `cancel` kills a sleeping fake job and marks cancelled; implement dispatch + lifecycle; green; commit.

### Task 6: rewrite slash commands
- [ ] `commands/review.md` / `adversarial-review.md`: foreground = run companion and return stdout verbatim; `--background` = `Bash(run_in_background: true)` then point user at `/agy-cli:status`; wait/background AskUserQuestion flow copied from codex plugin. New `status.md`/`result.md`/`cancel.md` using inline `!`-execution. Commit.

### Task 7: live smoke test + docs
- [ ] Real run: `node scripts/agy-companion.mjs review` in this repo (exit 0, `## Verdict` present); `status` and `result` show the job. Update README (commands, Node requirement, layout). Update memory roadmap. Commit.
