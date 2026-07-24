# agy-cli — Antigravity CLI plugin for Claude Code

A [Claude Code](https://claude.com/claude-code) plugin that lets Claude collaborate with **Google Antigravity CLI (`agy`)** running **Gemini 3.6 Flash** — get second opinions, parallel code reviews, or offload analysis subtasks to Gemini while Claude keeps coding.

讓 Claude Code 在撰寫程式時能呼叫 Antigravity CLI 的 Gemini 3.6 Flash 協作：第二意見、平行 code review、分析子任務委派。

## Features

- **`/agy` slash command** — manually send any prompt to Gemini 3.6 Flash (`/agy review src/foo.ts for concurrency bugs`)
- **`/agy-cli:review`** — Gemini code review of your working tree or branch (`--base main`), same read-only guarantees; supports `--wait`/`--background`
- **`/agy-cli:adversarial-review`** — steerable challenge review that questions the design; takes focus text (`/agy-cli:adversarial-review --base main look for race conditions`)
- **`/agy-cli:task`** — delegate any prompt to Gemini as a tracked job; `--resume` continues the previous Gemini conversation in this repo
- **`/agy-cli:status` / `/agy-cli:result` / `/agy-cli:cancel`** — track, read back, and stop background jobs (per-repo job state); `status --wait` blocks until a job finishes, running jobs show a live phase, and results include the conversation ID for `agy --conversation <id> -i`
- **`/agy-cli:setup`** — environment health check, plus an opt-in stop-time review gate (`--enable-review-gate`): Gemini reviews your dirty working tree each time Claude finishes and blocks completion on material findings
- **`gemini-flash` subagent** — Claude automatically delegates self-contained subtasks (reviews, analysis, second opinions) to Gemini during coding and brings the results back
- **Model override** — defaults to `Gemini 3.6 Flash (Medium)`; ask for any model `agy models` supports
- **`gemini-prompting` skill** — internal guidance Claude loads when shaping prompts for Gemini (output contracts, read-only framing, model choice)
- Works in Claude Code's sandboxed shell — no special permissions needed beyond running `agy`

## How it works

Every command, the `/agy` skill, and the `gemini-flash` subagent route through a Node.js **companion runtime** (`scripts/agy-companion.mjs`) that drives agy's non-interactive print mode and handles its headless pitfalls for you:

- **stdin hang** — agy hangs forever on an open non-TTY stdin; the companion spawns it with stdin closed.
- **File reads** — headless agy auto-denies its own tool permission prompts, so the companion runs `--mode plan`, which auto-approves read-only tools (write tools stay blocked); `--add-dir` scopes what Gemini can see.
- **Windows argv cap** — command lines max out around 32KB, so the assembled prompt (which can embed a whole diff) is written to a file that Gemini reads itself.
- **Job tracking** — every run is recorded as a per-repo job (status, output, agy conversation ID), enabling background runs, `/agy-cli:status`/`result`/`cancel`, and `--resume`.
- **Silent failures** — agy can exit 0 with no output when Gemini requests a tool that headless mode must deny (e.g. running a terminal command); the companion records that as a failure with agy's explanation instead of an empty success, and the prompts tell Gemini up front that command tools are unavailable.
- **Orphan cleanup** — session lifecycle hooks (and every `status` call) mark running jobs whose process died as failed, so the job table never shows phantoms.

`--model` accepts either the full display name with reasoning-effort suffix, quoted (`"Gemini 3.6 Flash (Medium)"`, `"Gemini 3.1 Pro (Low)"`), or a short id from `agy models` (`gemini-3.6-flash-medium`). An invalid name exits 1 and prints the valid list.

Job state lives under `CLAUDE_PLUGIN_DATA` (fallback: `<tmpdir>/agy-companion`), keyed per repository, pruned to the 50 most recent jobs.

## Prerequisites

- [Claude Code](https://claude.com/claude-code) installed
- Node.js ≥ 18.18 (the companion runtime is plain Node, no dependencies)
- [Antigravity CLI](https://antigravity.google) installed and logged in:

  ```powershell
  # Windows (PowerShell)
  irm https://antigravity.google/cli/install.ps1 | iex
  ```

  ```bash
  # macOS / Linux
  curl -fsSL https://antigravity.google/cli/install.sh | bash
  ```

  Then run `agy` once interactively to complete sign-in.

## Installation

From GitHub:

```
claude plugin marketplace add Lanticee/agy-plugin
claude plugin install agy-cli@agy-plugin
```

From a local clone:

```
claude plugin marketplace add /path/to/agy-plugin
claude plugin install agy-cli@agy-plugin
```

Or for local development without installing:

```
claude --plugin-dir /path/to/agy-plugin
```

## Usage

**Manual — slash command:**

```
/agy summarize the architecture of this repo
/agy review src/auth.ts and list potential security issues
```

**Automatic — during coding**, just ask naturally in any project:

> "請 Gemini 幫忙 review 這三個檔案"
> "Ask Gemini for a second opinion on this design"

Claude will delegate to the `gemini-flash` subagent and report Gemini's answer back, clearly attributed.

**Code review:**

```
/agy-cli:review
/agy-cli:review --base main
/agy-cli:adversarial-review challenge the caching design
```

Both commands collect your git diff, send it to Gemini through `agy --print --mode plan` (read-only), and return the review verbatim. Nothing is modified.

Reviews run through a Node.js companion runtime (`scripts/agy-companion.mjs`, requires Node ≥ 18.18) that records every run as a job. Run with `--background` (or pick "Run in background" when asked) and check in later:

```
/agy-cli:review --background
/agy-cli:status
/agy-cli:status --wait
/agy-cli:result
/agy-cli:cancel
```

`status` shows a live phase for running jobs (`starting` / `generating` / `finalizing`, read from agy's own log) and automatically marks jobs whose process died as failed. `status --wait [--timeout-ms <ms>]` blocks until the job finishes and prints its result (default timeout 240s). Review outputs end with a machine-readable `VERDICT:` line, which the review gate and scripts can parse reliably. See [CHANGELOG.md](CHANGELOG.md) for version history.

**Task delegation with memory:**

```
/agy-cli:task summarize the error handling in src/server.ts
/agy-cli:task --resume now compare it with src/client.ts
```

Every run records its agy conversation ID, so `--resume` continues where Gemini left off, and `/agy-cli:result` prints an `agy --conversation <id> -i` command to pick the thread up interactively in agy itself.

**Review gate (optional, off by default):**

```
/agy-cli:setup --enable-review-gate
/agy-cli:setup --disable-review-gate
```

When enabled, a `Stop` hook runs a Gemini review of your dirty working tree each time Claude finishes a turn; a `needs-attention` verdict blocks the stop so Claude addresses the findings first. It fails open (any error lets the session continue), and skips when the tree is clean. Like the Codex plugin's equivalent, it can create long Claude/Gemini loops and drain quota — enable it only while actively monitoring the session.

**Fewer permission prompts** — add to your project's `.claude/settings.json`:

```json
{
  "permissions": {
    "allow": ["Bash(agy --print*)"]
  }
}
```

## Repository layout

```
agy-plugin/
├── .claude-plugin/
│   ├── plugin.json          # plugin manifest
│   └── marketplace.json     # marketplace definition (install via `claude plugin marketplace add`)
├── agents/
│   └── gemini-flash.md      # subagent: delegate subtasks to Gemini 3.6 Flash
├── commands/
│   ├── setup.md             # /agy-cli:setup — env doctor + review-gate toggle
│   ├── review.md            # /agy-cli:review — Gemini code review of git state
│   ├── adversarial-review.md# /agy-cli:adversarial-review — steerable challenge review
│   ├── task.md              # /agy-cli:task — delegate a prompt to Gemini (resumable)
│   ├── status.md            # /agy-cli:status — list running/recent review jobs
│   ├── result.md            # /agy-cli:result — stored output of a finished job
│   └── cancel.md            # /agy-cli:cancel — stop a running background job
├── prompts/
│   ├── review.md            # review prompt template
│   └── adversarial-review.md# adversarial review prompt template
├── hooks/
│   └── hooks.json           # SessionStart/SessionEnd cleanup + Stop review gate
├── scripts/
│   ├── agy-companion.mjs    # companion runtime: job execution + tracking
│   ├── stop-review-gate-hook.mjs  # opt-in stop-time review gate (fail-open)
│   ├── session-lifecycle-hook.mjs # orphaned-job cleanup on session start/end
│   ├── bump-version.mjs     # bump plugin.json + package.json versions in sync
│   └── lib/                 # args/state/git/prompts/agy/jobs/render modules
├── skills/
│   ├── agy/
│   │   └── SKILL.md         # /agy slash command
│   └── gemini-prompting/
│       └── SKILL.md         # prompt-writing guidance for Gemini via agy
├── tests/                   # node --test suite (fake agy, no real API calls)
├── .github/workflows/       # CI: npm test on ubuntu + windows
├── CHANGELOG.md             # version history (current: see plugin.json)
└── README.md
```

Run the tests with `npm test` — they use a fake agy binary and never call the real API.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `agy` hangs with no output | stdin not redirected — always use `< /dev/null` (bash) or `< NUL` (cmd) |
| `agy models` prints nothing | Known behavior in non-TTY mode (exit 0, empty output); run it in a real terminal |
| Auth errors | Run `agy` interactively once in a terminal to sign in |
| Gemini needs to edit files | Print mode can't answer permission prompts — keep delegated tasks read-only/analysis. Editing would require `--dangerously-skip-permissions`, which this plugin deliberately never uses |
| Job stuck in `running` | `/agy-cli:cancel <job-id>` marks it cancelled and kills the process tree; orphans (dead process) are auto-marked failed by `status` and the session hooks |
| Job failed with "no output produced … command permission" | Gemini tried to run a terminal command, which headless mode auto-denies. Rephrase the task as read-only analysis; the prompts already tell Gemini this, but it occasionally tries anyway |
| Review gate blocks repeatedly / burns quota | `/agy-cli:setup --disable-review-gate`; the gate is per-repo and off by default |

## License

MIT
