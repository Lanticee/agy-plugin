---
description: Show the stored Gemini output for a finished agy review job
argument-hint: '[job-id]'
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/agy-companion.mjs" result "$ARGUMENTS"`

Present the command output to the user verbatim. Do not paraphrase, summarize, or filter the review findings, and do not fix any issues it mentions.
