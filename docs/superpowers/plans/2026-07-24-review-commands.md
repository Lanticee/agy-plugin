# agy Review Commands (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `/agy-cli:review` and `/agy-cli:adversarial-review` slash commands that run a Gemini code review over local git state via `agy --print`.

**Architecture:** Each command is a markdown file under `commands/` whose instructions tell Claude to (1) resolve the review target (working tree vs branch diff), (2) collect git context with plain `git` commands, (3) interpolate it into a prompt template stored under `prompts/`, (4) write the assembled prompt to a temp file and run `agy --print "$(cat <file>)" --mode plan ... < /dev/null`, and (5) return agy's output verbatim. No companion script yet (that is Phase 2); all logic lives in command prose, mirroring how the OpenAI codex-plugin-cc structures its prompts but adapted to agy's headless constraints.

**Tech Stack:** Claude Code plugin (markdown commands + prompt templates), git, Antigravity CLI (`agy`).

## Global Constraints

- Never use `--dangerously-skip-permissions` (existing plugin policy).
- Every `agy` invocation MUST redirect stdin: `< /dev/null` (bash). agy hangs forever on a non-TTY open stdin.
- Every `agy` invocation uses `--mode plan` (auto-approves read-only tools headlessly) and `--add-dir <repo root>`.
- Default model is `"Gemini 3.6 Flash (Medium)"`; user may override via `--model`.
- Review commands are read-only: they must never fix code or apply patches.
- Plugin name is `agy-cli`, so commands surface as `/agy-cli:review` and `/agy-cli:adversarial-review`.
- Prompt template placeholders use `{{NAME}}` syntax and are interpolated by Claude (prose instruction), not by a script.

---

### Task 1: Review prompt template

**Files:**
- Create: `prompts/review.md`

**Interfaces:**
- Produces: template with placeholders `{{TARGET_LABEL}}`, `{{COLLECTION_GUIDANCE}}`, `{{REVIEW_INPUT}}` — consumed by Task 3's command.

- [ ] **Step 1: Write the template**

```markdown
<role>
You are Gemini performing a professional code review.
Give the same quality of review a strong senior engineer would give before approving a pull request.
</role>

<task>
Review the change described in the repository context below.
Target: {{TARGET_LABEL}}
</task>

<review_method>
Read the diff carefully. When a hunk's correctness depends on surrounding code, open the affected file with your read tools and check the real context before judging.
{{COLLECTION_GUIDANCE}}
Prioritize correctness, security, data loss, concurrency, and API-contract regressions over style.
</review_method>

<finding_bar>
Report only material findings. Skip style nits, naming preferences, and speculative concerns without evidence.
Every finding must answer: what is wrong, where (file and line), why it matters, and what concrete change fixes it.
</finding_bar>

<output_contract>
Respond in markdown, in this exact structure:

## Verdict
One line: `approve` or `needs-attention`, followed by a one-sentence ship/no-ship assessment.

## Findings
For each finding (omit the section entirely if there are none):

### [P0|P1|P2|P3] <short title>
- **File:** <path>:<line-start>-<line-end>
- **Problem:** <what goes wrong and when>
- **Fix:** <concrete recommendation>

Severity scale: P0 = must fix before ship, P1 = should fix, P2 = worth fixing, P3 = optional.
Prefer one strong finding over several weak ones. If the change looks safe, say so directly and return no findings.
</output_contract>

<grounding_rules>
Every finding must be defensible from the repository context or files you actually read.
Do not invent files, lines, or behavior you cannot support. State inferences explicitly.
</grounding_rules>

<repository_context>
{{REVIEW_INPUT}}
</repository_context>
```

- [ ] **Step 2: Verify placeholders**

Run: `grep -o '{{[A-Z_]*}}' prompts/review.md | sort -u`
Expected output exactly:
```
{{COLLECTION_GUIDANCE}}
{{REVIEW_INPUT}}
{{TARGET_LABEL}}
```

- [ ] **Step 3: Commit**

```bash
git add prompts/review.md
git commit -m "feat: add review prompt template"
```

---

### Task 2: Adversarial review prompt template

**Files:**
- Create: `prompts/adversarial-review.md`

**Interfaces:**
- Produces: template with placeholders `{{TARGET_LABEL}}`, `{{USER_FOCUS}}`, `{{COLLECTION_GUIDANCE}}`, `{{REVIEW_INPUT}}` — consumed by Task 4's command.

- [ ] **Step 1: Write the template**

```markdown
<role>
You are Gemini performing an adversarial software review.
Your job is to break confidence in the change, not to validate it.
</role>

<task>
Review the repository context below as if you are trying to find the strongest reasons this change should not ship yet.
Target: {{TARGET_LABEL}}
User focus: {{USER_FOCUS}}
</task>

<operating_stance>
Default to skepticism.
Assume the change can fail in subtle, high-cost, or user-visible ways until the evidence says otherwise.
Do not give credit for good intent, partial fixes, or likely follow-up work.
If something only works on the happy path, treat that as a real weakness.
</operating_stance>

<attack_surface>
Prioritize failures that are expensive, dangerous, or hard to detect:
- auth, permissions, tenant isolation, and trust boundaries
- data loss, corruption, duplication, and irreversible state changes
- rollback safety, retries, partial failure, and idempotency gaps
- race conditions, ordering assumptions, stale state, and re-entrancy
- empty-state, null, timeout, and degraded dependency behavior
- version skew, schema drift, migration hazards, and compatibility regressions
- observability gaps that would hide failure or make recovery harder
</attack_surface>

<review_method>
Actively try to disprove the change.
Look for violated invariants, missing guards, unhandled failure paths, and assumptions that stop being true under stress.
Trace how bad inputs, retries, concurrent actions, or partially completed operations move through the code.
If the user supplied a focus area, weight it heavily, but still report any other material issue you can defend.
When a hunk's correctness depends on surrounding code, open the affected file with your read tools and check the real context.
{{COLLECTION_GUIDANCE}}
</review_method>

<finding_bar>
Report only material findings. No style feedback, naming feedback, or speculative concerns without evidence.
A finding must answer: what can go wrong, why this code path is vulnerable, the likely impact, and what concrete change reduces the risk.
</finding_bar>

<output_contract>
Respond in markdown, in this exact structure:

## Verdict
One line: `approve` or `needs-attention`, followed by a terse ship/no-ship assessment — not a neutral recap.
Use `needs-attention` if there is any material risk worth blocking on.
Use `approve` only if you cannot support any substantive adversarial finding from the provided context.

## Findings
For each finding (omit the section entirely if there are none):

### [P0|P1|P2|P3] <short title>
- **File:** <path>:<line-start>-<line-end>
- **Failure scenario:** <concrete inputs/state that trigger it and the impact>
- **Fix:** <concrete recommendation>
- **Confidence:** <0.0–1.0>
</output_contract>

<grounding_rules>
Be aggressive, but stay grounded.
Every finding must be defensible from the provided repository context or files you actually read.
Do not invent files, lines, code paths, incidents, attack chains, or runtime behavior you cannot support.
If a conclusion depends on an inference, state that explicitly and keep the confidence honest.
Prefer one strong finding over several weak ones. If the change looks safe, say so directly and return no findings.
</grounding_rules>

<repository_context>
{{REVIEW_INPUT}}
</repository_context>
```

- [ ] **Step 2: Verify placeholders**

Run: `grep -o '{{[A-Z_]*}}' prompts/adversarial-review.md | sort -u`
Expected output exactly:
```
{{COLLECTION_GUIDANCE}}
{{REVIEW_INPUT}}
{{TARGET_LABEL}}
{{USER_FOCUS}}
```

- [ ] **Step 3: Commit**

```bash
git add prompts/adversarial-review.md
git commit -m "feat: add adversarial review prompt template"
```

---

### Task 3: /agy-cli:review command

**Files:**
- Create: `commands/review.md`

**Interfaces:**
- Consumes: `prompts/review.md` placeholders from Task 1 (`{{TARGET_LABEL}}`, `{{COLLECTION_GUIDANCE}}`, `{{REVIEW_INPUT}}`).
- Produces: the shared "review flow" prose (target resolution, context collection, agy invocation) that Task 4 repeats with its own template.

- [ ] **Step 1: Write the command file**

```markdown
---
description: Run a Gemini code review (via agy) against local git state
argument-hint: '[--base <ref>] [--scope auto|working-tree|branch] [--model <name>]'
disable-model-invocation: true
allowed-tools: Read, Glob, Grep, Bash, Write
---

Run a Gemini code review through the Antigravity CLI.

Raw slash-command arguments:
`$ARGUMENTS`

Core constraints:
- This command is review-only. Do not fix issues, apply patches, or offer to make changes.
- Your only job is to run the review and return Gemini's output verbatim to the user.
- Never use `--dangerously-skip-permissions`.

## 1. Resolve the review target

- If `$ARGUMENTS` contains `--base <ref>`: branch review against `<ref>`. Target label: `branch diff against <ref>`.
- Else if `--scope working-tree`: working-tree review. Target label: `working tree diff`.
- Else if `--scope branch`: detect the default branch (`git symbolic-ref refs/remotes/origin/HEAD`, falling back to `main`/`master`) and do a branch review against it.
- Else (auto): run `git status --short --untracked-files=all`. If the working tree is dirty (any staged, unstaged, or untracked entries), review the working tree; otherwise do a branch review against the detected default branch.
- If there is nothing to review (clean tree AND empty branch diff), tell the user and stop.

## 2. Collect the repository context

All git commands run from the repo root (`git rev-parse --show-toplevel`).

For a working-tree review, capture:
- `git status --short --untracked-files=all` (section "Git Status")
- `git diff --cached --no-ext-diff` (section "Staged Diff")
- `git diff --no-ext-diff` (section "Unstaged Diff")
- untracked files: inline each text file under 24KB in a fenced block (section "Untracked Files"); note skipped binaries/oversized files.

For a branch review against `<base>`, capture:
- `git log --oneline --decorate <base>..HEAD` (section "Commit Log")
- `git diff --stat <base>...HEAD` (section "Diff Stat")
- `git diff --no-ext-diff <base>...HEAD` (section "Branch Diff")

Size rule: if the combined diff exceeds ~200KB, do NOT inline the full diff. Instead include only the status/log, `--stat` output, and the changed-file list, and set the collection guidance below to the self-collect variant.

## 3. Assemble the prompt

Read the template at `${CLAUDE_PLUGIN_ROOT}/prompts/review.md` and replace:
- `{{TARGET_LABEL}}` → the target label from step 1
- `{{REVIEW_INPUT}}` → the sections from step 2, each formatted as `## <Section>` followed by its content
- `{{COLLECTION_GUIDANCE}}` →
  - inline diff: `Use the repository context below as primary evidence.`
  - self-collect: `The repository context below is a lightweight summary. Open the listed changed files with your read tools and inspect them before finalizing findings.`

Write the assembled prompt to a temp file (e.g. under the session scratchpad or `$TMPDIR`).

## 4. Run agy

Model: `"Gemini 3.6 Flash (Medium)"` unless the user passed `--model <name>` (pass their value through verbatim).

```bash
agy --print "$(cat <temp-prompt-file>)" --add-dir "<repo root>" \
  --mode plan --model "Gemini 3.6 Flash (Medium)" --print-timeout 10m < /dev/null
```

- The `< /dev/null` stdin redirect is mandatory — agy hangs forever without it on a non-TTY.
- `--mode plan` lets agy read files itself (read-only tools auto-approved); `--add-dir` scopes it to the repo.
- If agy exits non-zero or times out, report the error verbatim; do not review the code yourself.

## 5. Return the result

Return agy's stdout verbatim, prefixed with one line: `Gemini review via agy (<model>), target: <target label>`.
Do not paraphrase, summarize, filter, or add commentary. Do not fix any issues mentioned in the review.
```

- [ ] **Step 2: Verify frontmatter and references**

Run: `head -7 commands/review.md`
Expected: YAML frontmatter block containing `description`, `argument-hint`, `disable-model-invocation: true`, `allowed-tools`.

Run: `grep -c 'CLAUDE_PLUGIN_ROOT' commands/review.md`
Expected: `1` or more.

- [ ] **Step 3: Commit**

```bash
git add commands/review.md
git commit -m "feat: add /agy-cli:review command"
```

---

### Task 4: /agy-cli:adversarial-review command

**Files:**
- Create: `commands/adversarial-review.md`

**Interfaces:**
- Consumes: `prompts/adversarial-review.md` placeholders from Task 2 (adds `{{USER_FOCUS}}`).

- [ ] **Step 1: Write the command file**

Identical flow to `commands/review.md` with three differences: the template path, focus-text handling, and the result prefix. Full content:

```markdown
---
description: Run a steerable adversarial Gemini review (via agy) that challenges the design, not just the code
argument-hint: '[--base <ref>] [--scope auto|working-tree|branch] [--model <name>] [focus text]'
disable-model-invocation: true
allowed-tools: Read, Glob, Grep, Bash, Write
---

Run an adversarial Gemini review through the Antigravity CLI.

Raw slash-command arguments:
`$ARGUMENTS`

Core constraints:
- This command is review-only. Do not fix issues, apply patches, or offer to make changes.
- Your only job is to run the review and return Gemini's output verbatim to the user.
- Never use `--dangerously-skip-permissions`.

## 1. Resolve the review target and focus

Flags (`--base <ref>`, `--scope <value>`, `--model <name>`) are routing controls. Everything left in `$ARGUMENTS` after removing them is the user's focus text.

- If `--base <ref>` is present: branch review against `<ref>`. Target label: `branch diff against <ref>`.
- Else if `--scope working-tree`: working-tree review. Target label: `working tree diff`.
- Else if `--scope branch`: detect the default branch (`git symbolic-ref refs/remotes/origin/HEAD`, falling back to `main`/`master`) and do a branch review against it.
- Else (auto): run `git status --short --untracked-files=all`. If the working tree is dirty (any staged, unstaged, or untracked entries), review the working tree; otherwise do a branch review against the detected default branch.
- If there is nothing to review (clean tree AND empty branch diff), tell the user and stop.

## 2. Collect the repository context

All git commands run from the repo root (`git rev-parse --show-toplevel`).

For a working-tree review, capture:
- `git status --short --untracked-files=all` (section "Git Status")
- `git diff --cached --no-ext-diff` (section "Staged Diff")
- `git diff --no-ext-diff` (section "Unstaged Diff")
- untracked files: inline each text file under 24KB in a fenced block (section "Untracked Files"); note skipped binaries/oversized files.

For a branch review against `<base>`, capture:
- `git log --oneline --decorate <base>..HEAD` (section "Commit Log")
- `git diff --stat <base>...HEAD` (section "Diff Stat")
- `git diff --no-ext-diff <base>...HEAD` (section "Branch Diff")

Size rule: if the combined diff exceeds ~200KB, do NOT inline the full diff. Instead include only the status/log, `--stat` output, and the changed-file list, and set the collection guidance below to the self-collect variant.

## 3. Assemble the prompt

Read the template at `${CLAUDE_PLUGIN_ROOT}/prompts/adversarial-review.md` and replace:
- `{{TARGET_LABEL}}` → the target label from step 1
- `{{USER_FOCUS}}` → the user's focus text, or `(none — general adversarial review)` if empty
- `{{REVIEW_INPUT}}` → the sections from step 2, each formatted as `## <Section>` followed by its content
- `{{COLLECTION_GUIDANCE}}` →
  - inline diff: `Use the repository context below as primary evidence.`
  - self-collect: `The repository context below is a lightweight summary. Open the listed changed files with your read tools and inspect them before finalizing findings.`

Write the assembled prompt to a temp file (e.g. under the session scratchpad or `$TMPDIR`).

## 4. Run agy

Model: `"Gemini 3.6 Flash (Medium)"` unless the user passed `--model <name>` (pass their value through verbatim).

```bash
agy --print "$(cat <temp-prompt-file>)" --add-dir "<repo root>" \
  --mode plan --model "Gemini 3.6 Flash (Medium)" --print-timeout 10m < /dev/null
```

- The `< /dev/null` stdin redirect is mandatory — agy hangs forever without it on a non-TTY.
- `--mode plan` lets agy read files itself (read-only tools auto-approved); `--add-dir` scopes it to the repo.
- If agy exits non-zero or times out, report the error verbatim; do not review the code yourself.

## 5. Return the result

Return agy's stdout verbatim, prefixed with one line: `Gemini adversarial review via agy (<model>), target: <target label>, focus: <focus or none>`.
Do not paraphrase, summarize, filter, or add commentary. Do not fix any issues mentioned in the review.
```

- [ ] **Step 2: Verify frontmatter and references**

Run: `head -7 commands/adversarial-review.md`
Expected: YAML frontmatter with `description`, `argument-hint`, `disable-model-invocation: true`, `allowed-tools`.

Run: `grep -c 'adversarial-review.md' commands/adversarial-review.md`
Expected: `1` or more (template path reference).

- [ ] **Step 3: Commit**

```bash
git add commands/adversarial-review.md
git commit -m "feat: add /agy-cli:adversarial-review command"
```

---

### Task 5: Live smoke test

**Files:**
- None created (temp files only).

**Interfaces:**
- Consumes: everything from Tasks 1–4.

- [ ] **Step 1: Assemble and run a real review against this repo's current diff**

From the repo root, with the Phase 1 files uncommitted-or-committed, simulate exactly what the command prose instructs: collect `git diff` context for the working tree (or `--base HEAD~1` if clean), interpolate `prompts/review.md`, write to a temp file, then run:

```bash
agy --print "$(cat "$TMPDIR/agy-review-prompt.md")" --add-dir "$(git rev-parse --show-toplevel)" \
  --mode plan --model "Gemini 3.6 Flash (Medium)" --print-timeout 10m < /dev/null
```

Expected: exit 0; stdout contains a `## Verdict` line with `approve` or `needs-attention`.

- [ ] **Step 2: Fix anything the smoke test surfaces**

If agy errors (model name, timeout, prompt too long), adjust the command prose/template accordingly and re-run until Step 1 passes.

- [ ] **Step 3: Commit any fixes**

```bash
git add -A
git commit -m "fix: adjust review flow after live smoke test"
```

(Skip if no fixes were needed.)

---

### Task 6: Documentation

**Files:**
- Modify: `README.md` (Features and Usage sections)

- [ ] **Step 1: Add the commands to Features**

In the `## Features` list, after the `/agy` bullet, add:

```markdown
- **`/agy-cli:review`** — Gemini code review of your working tree or branch (`--base main`), same read-only guarantees
- **`/agy-cli:adversarial-review`** — steerable challenge review that questions the design; takes focus text (`/agy-cli:adversarial-review --base main look for race conditions`)
```

- [ ] **Step 2: Add a Usage subsection**

After the existing usage examples, add:

```markdown
**Code review:**

```
/agy-cli:review
/agy-cli:review --base main
/agy-cli:adversarial-review challenge the caching design
```

Both commands collect your git diff, send it to Gemini through `agy --print --mode plan` (read-only), and return the review verbatim. Nothing is modified.
```

- [ ] **Step 3: Update the Repository layout tree**

Add `commands/` and `prompts/` entries to the layout block:

```
├── commands/
│   ├── review.md            # /agy-cli:review — Gemini code review of git state
│   └── adversarial-review.md# /agy-cli:adversarial-review — steerable challenge review
├── prompts/
│   ├── review.md            # review prompt template
│   └── adversarial-review.md# adversarial review prompt template
```

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: document review commands"
```
