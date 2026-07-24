---
name: gemini-prompting
description: Guidance for writing effective prompts for Gemini models called through the agy CLI. Use when shaping a task, review focus, or delegated prompt before sending it to Gemini via the agy companion.
user-invocable: false
---

# Prompting Gemini via agy

Rules of thumb for prompts forwarded to Gemini (Flash or Pro) through `agy --print --mode plan`:

**Make it self-contained.** Gemini cannot see the Claude conversation. Include absolute file paths, the goal, and any constraints in the prompt itself. Gemini can read workspace files with its own tools — reference paths instead of pasting whole files, but paste short snippets when the exact text matters.

**State the output contract explicitly.** Gemini follows concrete format instructions well: "Respond in markdown with sections X and Y", "Reply with just the token", "List at most 5 items". Without a contract it tends toward long, hedged prose.

**One task per prompt.** Split "review this AND refactor that AND summarize" into separate delegations (use `--resume` to keep shared context across them).

**Ask for evidence, not vibes.** For analysis tasks, require file:line references and a confidence statement. Gemini Flash is fast but will fill gaps with plausible-sounding inference — force it to mark inference as such.

**Steer severity.** For reviews, say what matters ("prioritize data loss and concurrency; ignore style") — otherwise you get a mix of nits and substance.

**Keep the read-only frame.** Headless agy cannot edit files or run commands. Phrase tasks as analysis: "describe the exact changes" rather than "make the changes".

**Model choice.** Default Flash (Medium) handles review/summarize/analyze well. Suggest a Pro model (`"Gemini 3.1 Pro (Low)"` etc.) only for deep multi-file reasoning where Flash's answer proved shallow — it is much slower.
