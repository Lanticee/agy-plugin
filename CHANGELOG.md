# Changelog

## 0.5.0 — 2026-07-24

Codex-parity mechanics:

- `status --wait [--timeout-ms <ms>]` blocks until a background job finishes, then prints its result (default 240s, 2s poll).
- Progress phases (`starting` / `generating` / `finalizing`) inferred from agy's own log; shown in the status table and single-job view.
- Review templates end with a machine-readable `VERDICT: approve|needs-attention` line; the review gate prefers it (with the old `## Verdict` scan as fallback).
- `SessionStart`/`SessionEnd` lifecycle hook marks orphaned running jobs as failed; `status` also reaps on every call.
- Versioning: `plugin.json`/`package.json` version fields, this changelog, and `scripts/bump-version.mjs`.

## 0.4.0 — 2026-07-24

- `/agy-cli:setup` environment doctor with per-repo config.
- Opt-in stop-time review gate (`--enable-review-gate`): Stop hook reviews the dirty working tree and blocks on needs-attention; fail-open by design.
- `gemini-prompting` skill; GitHub Actions CI (ubuntu + windows).

## 0.3.0 — 2026-07-24

- `/agy-cli:task` delegation with conversation resume (`--resume`, `--conversation <id>`); every job records its agy conversation ID.
- `gemini-flash` subagent and `/agy` skill became thin forwarders through the companion.

## 0.2.0 — 2026-07-24

- Node.js companion runtime (`scripts/agy-companion.mjs`): per-repo job tracking, background runs, `/agy-cli:status`, `/agy-cli:result`, `/agy-cli:cancel`.
- Windows argv-limit handling (prompts delivered via file), quoted-flag parsing, default-branch ref fixes.

## 0.1.0 — 2026-07-24

- `/agy-cli:review` and `/agy-cli:adversarial-review` with prompt templates ported from the OpenAI codex-plugin-cc design.
- Initial `/agy` skill and `gemini-flash` subagent (direct agy invocation).
