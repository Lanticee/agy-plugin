---
description: Check agy environment health and manage the optional stop-time review gate
argument-hint: '[--enable-review-gate|--disable-review-gate]'
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/agy-companion.mjs" setup "$ARGUMENTS"`

Present the report to the user as-is.

If the report shows the agy binary is missing, point the user to the install commands in the plugin README (`irm https://antigravity.google/cli/install.ps1 | iex` on Windows, `curl -fsSL https://antigravity.google/cli/install.sh | bash` on macOS/Linux) and remind them to run `agy` once interactively to sign in.

If the user just enabled the review gate, warn them: the gate runs a Gemini review of the dirty working tree every time Claude finishes a turn and blocks completion on material findings — it can create long review loops and consume quota quickly. Only keep it on while actively monitoring the session.
