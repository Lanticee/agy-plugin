# agy Setup, Review Gate, Prompting Skill, CI (Phase 4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Round out the codex-plugin port: `/agy-cli:setup` doctor with an opt-in Stop-hook review gate, a Gemini prompting skill, and CI.

**Architecture:** State gains a `config` section (`stopReviewGate`, default false, per-workspace). `setup` subcommand reports environment health and toggles the gate. A `Stop` hook (`hooks/hooks.json` → `scripts/stop-review-gate-hook.mjs`) runs only when the gate is enabled, the stop is not already hook-driven (`stop_hook_active`), and the working tree is dirty; it shells to `companion review --wait --scope working-tree`, and blocks the stop (JSON `{"decision":"block"}`) only on a `needs-attention` verdict. All failures fail open (exit 0) — the gate must never wedge a session.

**Tech Stack:** Same as Phases 2–3; GitHub Actions (ubuntu + windows, Node 20).

## Global Constraints

- All prior constraints hold. Gate failures are always fail-open.
- Gate blocks at most once per stop chain (`stop_hook_active` → exit 0).
- Default state: gate OFF. Enabling requires explicit `/agy-cli:setup --enable-review-gate`.

## File Structure

- Modify: `scripts/lib/state.mjs` — `config` in default state, `getConfig(cwd)` / `setConfig(cwd,key,value)`, saveState preserves config
- Modify: `scripts/lib/args.mjs` — boolean flags `enable-review-gate`, `disable-review-gate`
- Modify: `scripts/agy-companion.mjs` — `setup` subcommand (env report + gate toggle)
- Create: `scripts/stop-review-gate-hook.mjs` — Stop hook (stdin JSON, fail-open)
- Create: `hooks/hooks.json` — Stop hook registration, 900s timeout
- Modify: `tests/fake-agy.mjs` — `FAKE_AGY_VERDICT` env picks the verdict line
- Create: `tests/hook.test.mjs`, extend `tests/runtime.test.mjs` (setup toggle)
- Create: `commands/setup.md`, `skills/gemini-prompting/SKILL.md`
- Create: `.github/workflows/test.yml`
- Modify: `agents/gemini-flash.md` (reference prompting skill), `README.md`

### Task 1: config in state + setup subcommand (TDD)
- [ ] Tests: `setConfig`/`getConfig` round-trip and survive job pruning; `companion setup` prints agy/node/gate status; `--enable-review-gate` flips config and `--disable-review-gate` flips it back. Implement; green; commit.

### Task 2: stop-review-gate hook (TDD)
- [ ] Tests (fake agy): gate disabled → no output, exit 0; enabled + dirty tree + `FAKE_AGY_VERDICT=needs-attention` → stdout JSON `decision:"block"` with review text in reason; `approve` → no block; `stop_hook_active: true` → exit 0 untouched; clean tree → exit 0. Implement hook + `hooks/hooks.json`; green; commit.

### Task 3: setup command, prompting skill, CI, docs
- [ ] `commands/setup.md` (inline `!` execution + gate warning), `skills/gemini-prompting/SKILL.md` (concise Gemini prompt guidance), `.github/workflows/test.yml` (push/PR, ubuntu+windows, node 20, `npm test`), README section for setup/gate. Commit.

### Task 4: live smoke + merge
- [ ] Real: `companion setup` reports healthy env; enable gate, verify hook blocks on a dirty tree with a real Gemini `needs-attention` (or passes with approve), disable gate. Update memory. Merge to main.
