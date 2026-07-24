# agy Task Delegation + Resume (Phase 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `task` subcommand to the companion (delegate any prompt to Gemini, with conversation resume), route the gemini-flash subagent and /agy skill through it, and surface conversation IDs so runs can be continued in agy directly.

**Architecture:** Verified: `agy --log-file <f>` logs `Created conversation <uuid>` in print mode, and `agy --print ... --conversation <uuid>` resumes headlessly. The companion passes a per-job agy log file, parses the conversation ID after each run (reviews AND tasks), stores it on the job, and `task --resume` reuses the newest job's conversation. The gemini-flash agent becomes a thin forwarder (codex-rescue pattern): one Bash call to `companion task`, output returned verbatim.

**Tech Stack:** Same as Phase 2 (Node ≥ 18, node --test, fake agy).

## Global Constraints

- All Phase 2 constraints hold (no `--dangerously-skip-permissions`, stdin ignored, `--mode plan`, prompt-via-file for >32KB argv safety).
- Tasks are read-only analysis/diagnosis. If a task needs edits, the forwarder reports that instead of running it.
- Conversation IDs are stored per job; `--resume` picks the newest job in this repo that has one.

## File Structure

- Modify: `scripts/lib/agy.mjs` — `runAgy` gains `logFile` (passes `--log-file`) and `conversationId` (passes `--conversation`); new export `extractConversationId(logText)` matching `Created conversation ([0-9a-f-]{36})`, falling back to the `conversationID="..."` print-mode line for resumed runs
- Modify: `scripts/agy-companion.mjs` — new `task` subcommand (flags: `--model`, `--timeout`, `--resume`, `--conversation <id>`; rest = prompt); reviews and tasks both record `conversationId` + `agyLogFile`
- Modify: `scripts/lib/jobs.mjs` — `resolveResumeConversation(cwd)` → newest job with a conversationId, else throw
- Modify: `scripts/lib/state.mjs` — prune also removes `job.agyLogFile`
- Modify: `scripts/lib/render.mjs` — task header variant; result footer: `Continue this conversation in agy: agy --conversation <id> -i` when an ID exists
- Modify: `tests/fake-agy.mjs` — honors `--log-file` (writes a fake `Created conversation` line); dumps argv JSON to `FAKE_AGY_ARGS_FILE` when set
- Create: `commands/task.md` — `/agy-cli:task` (wait/background flow like review)
- Modify: `agents/gemini-flash.md` — thin forwarder to `companion task`
- Modify: `skills/agy/SKILL.md` — route through `companion task`, keep direct-agy fallback notes
- Tests: extend `tests/agy.test.mjs`, `tests/runtime.test.mjs`
- Modify: `README.md`

### Task 1: agy lib conversation support (TDD)
- [ ] Tests: `extractConversationId` parses the Created-conversation line and the `conversationID="..."` fallback; `runAgy` with fake agy + logFile yields a parseable log; `conversationId` option appends `--conversation <id>` (assert via `FAKE_AGY_ARGS_FILE`). Implement; green; commit.

### Task 2: companion `task` subcommand + resume (TDD)
- [ ] Runtime tests: `task "summarize x"` completes, records kind `task` and a conversationId; `task --resume "follow up"` passes `--conversation <stored id>` to agy; `task --resume` with no prior conversation errors cleanly; review jobs also store conversationId. Implement (`resolveResumeConversation`, task lifecycle mirrors review but prompt is the user text verbatim wrapped with a one-line read-only preamble); green; commit.

### Task 3: command + agent + skill wiring
- [ ] `commands/task.md` (wait/background AskUserQuestion flow; foreground returns stdout verbatim); rewrite `agents/gemini-flash.md` as strict forwarder (one Bash call, no self-answering, `--resume` routing rules); update `skills/agy/SKILL.md` to invoke `companion task`. Commit.

### Task 4: live smoke + docs
- [ ] Real run: `task "…"` then `task --resume "…"` proves memory carry-over; `result` shows the continue hint. README + memory roadmap update. Commit, merge.
