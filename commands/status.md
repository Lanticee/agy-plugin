---
description: Show running and recent agy jobs for this repository, or wait for one to finish
argument-hint: '[job-id] [--all] [--wait] [--timeout-ms <ms>]'
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/agy-companion.mjs" status "$ARGUMENTS"`

If the user did not pass a job ID:
- Render the command output as a single compact Markdown table for this repository's jobs.
- Preserve the actionable fields: job ID, kind, status, elapsed, target, summary, and the follow-up command hints.

If the user did pass a job ID:
- Present the full command output to the user without summarizing or condensing it.
