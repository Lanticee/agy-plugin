# agy Phase 5: Codex-parity mechanics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the remaining high-value codex-plugin mechanics: `status --wait`, progress/phase preview, machine-readable verdicts, session-lifecycle orphan reaping, and versioning.

**Architecture:** All poll/reap/progress logic lives in `scripts/lib/jobs.mjs`; the hook scripts and `status` stay thin. Verdicts gain a final `VERDICT: approve|needs-attention` machine line in the prompt templates (adapted from codex's JSON schema — agy has no server-side schema enforcement, so a single grep-stable line beats brittle client-side JSON). Orphan reaping (running jobs whose pid is dead → failed) runs from a new SessionStart/SessionEnd lifecycle hook AND at the top of every `status` call.

**Tech Stack:** unchanged.

## Global Constraints

- All prior constraints hold; hooks stay fail-open.
- `status --wait` default timeout 240000ms, poll every 2000ms (codex defaults).
- Phase inference from agy's own `--log-file` milestones: `Print mode: starting`→starting, `Sending user message`/`Streaming conversation`→generating, `Stream completed`→finalizing.

## Tasks

### Task 1: orphan reaping + progress/phase (TDD)
- [ ] `jobs.mjs`: `isPidAlive(pid)`, `reapOrphanJobs(cwd)` (running + dead pid → failed, summary "orphaned — process no longer running"), `readJobProgress(job)` → `{phase, lines}` from agyLogFile milestones. Unit tests: dead-pid job gets reaped; synthetic agy log maps to phases. `status` reaps first and shows `running (phase)` + milestone lines in single-job view. Commit.

### Task 2: status --wait (TDD)
- [ ] `args.mjs` value flag `timeout-ms`; `jobs.mjs` `waitForJob(cwd, reference, {timeoutMs, pollMs})`; `status --wait` polls until the referenced (or newest running) job finishes, then prints its result; timeout prints snapshot + note. Runtime test: slow fake agy in background, `status --wait` returns the completed result. Commit.

### Task 3: machine-readable verdict line (TDD)
- [ ] Templates end the output contract with: final line exactly `VERDICT: approve` or `VERDICT: needs-attention`. Hook `extractVerdict` prefers `/^VERDICT:\s*(approve|needs-attention)/mi`, falls back to the `## Verdict` scan (backtick test keeps covering the fallback). fake-agy emits the machine line when `FAKE_AGY_MACHINE_VERDICT=1`; new hook test for it. Commit.

### Task 4: session lifecycle hook
- [ ] `scripts/session-lifecycle-hook.mjs` (arg: SessionStart|SessionEnd; reads stdin JSON, reaps orphans for the cwd workspace, always exit 0); register both in `hooks/hooks.json` (timeout 10). Hook test: stale running job with dead pid gets marked failed. Commit.

### Task 5: versioning + docs
- [ ] `plugin.json` + `package.json` gain `"version": "0.5.0"`; `CHANGELOG.md` (phases 1–5); `scripts/bump-version.mjs` (`patch|minor|major` bumps both files in sync) + test. README: status --wait, progress, CHANGELOG mention. Live smoke: real background review + `status --wait`. Merge, push.
