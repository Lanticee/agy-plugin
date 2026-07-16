# agy-cli — Antigravity CLI plugin for Claude Code

A [Claude Code](https://claude.com/claude-code) plugin that lets Claude collaborate with **Google Antigravity CLI (`agy`)** running **Gemini 3.5 Flash** — get second opinions, parallel code reviews, or offload analysis subtasks to Gemini while Claude keeps coding.

讓 Claude Code 在撰寫程式時能呼叫 Antigravity CLI 的 Gemini 3.5 Flash 協作：第二意見、平行 code review、分析子任務委派。

## Features

- **`/agy` slash command** — manually send any prompt to Gemini 3.5 Flash (`/agy review src/foo.ts for concurrency bugs`)
- **`gemini-flash` subagent** — Claude automatically delegates self-contained subtasks (reviews, analysis, second opinions) to Gemini during coding and brings the results back
- **Model override** — defaults to `Gemini 3.5 Flash (Medium)`; ask for any model `agy models` supports
- Works in Claude Code's sandboxed shell — no special permissions needed beyond running `agy`

## How it works

Both the skill and the subagent shell out to agy's non-interactive print mode:

```bash
agy --print "<prompt>" --model "Gemini 3.5 Flash (Medium)" --print-timeout 5m < /dev/null
```

`--model` expects the model's full display name including the reasoning-effort suffix, quoted — `"Gemini 3.5 Flash (High)"`, `"Gemini 3.1 Pro (Low)"`, `"Claude Sonnet 4.6 (Thinking)"`. Short ids like `gemini-3.5-flash` are rejected with exit 1 and a list of valid names.

Since `agy` runs in your project's working directory, Gemini can read the codebase itself — Claude passes file paths, not file contents.

> [!IMPORTANT]
> The `< /dev/null` stdin redirect (or `< NUL` on cmd) is **required**. `agy` hangs forever when run from a non-TTY environment with an open stdin pipe. This plugin's instructions handle it automatically.

## Prerequisites

- [Claude Code](https://claude.com/claude-code) installed
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
│   └── gemini-flash.md      # subagent: delegate subtasks to Gemini 3.5 Flash
├── skills/
│   └── agy/
│       └── SKILL.md         # /agy slash command
└── README.md
```

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `agy` hangs with no output | stdin not redirected — always use `< /dev/null` (bash) or `< NUL` (cmd) |
| `agy models` prints nothing | Known behavior in non-TTY mode (exit 0, empty output); run it in a real terminal |
| Auth errors | Run `agy` interactively once in a terminal to sign in |
| Gemini needs to edit files | Print mode can't answer permission prompts — keep delegated tasks read-only/analysis. Editing would require `--dangerously-skip-permissions`, which this plugin deliberately never uses |

## License

MIT
