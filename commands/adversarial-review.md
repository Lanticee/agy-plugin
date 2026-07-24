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
