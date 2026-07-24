---
description: Cancel an active background agy review job
argument-hint: '[job-id]'
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/agy-companion.mjs" cancel "$ARGUMENTS"`

Present the command output to the user. If it reports that multiple jobs are active, ask the user which job ID to cancel and run `/agy-cli:cancel <job-id>`.
