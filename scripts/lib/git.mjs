import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const MAX_UNTRACKED_BYTES = 24 * 1024;
const MAX_INLINE_DIFF_BYTES = 200 * 1024;

// Repository-derived arguments must never pass through a shell.
function git(cwd, args, options = {}) {
  return spawnSync("git", args, { cwd, encoding: "utf8", shell: false, maxBuffer: 64 * 1024 * 1024, ...options });
}

function gitChecked(cwd, args, options = {}) {
  const result = git(cwd, args, options);
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr.trim()}`);
  }
  return result;
}

export function resolveWorkspaceRoot(cwd) {
  const result = git(cwd, ["rev-parse", "--show-toplevel"]);
  if (result.status === 0) {
    return result.stdout.trim();
  }
  return path.resolve(cwd);
}

export function ensureGitRepository(cwd) {
  const result = git(cwd, ["rev-parse", "--show-toplevel"]);
  if (result.error && result.error.code === "ENOENT") {
    throw new Error("git is not installed. Install Git and retry.");
  }
  if (result.status !== 0) {
    throw new Error("This command must run inside a Git repository.");
  }
  return result.stdout.trim();
}

export function detectDefaultBranch(cwd) {
  const symbolic = git(cwd, ["symbolic-ref", "refs/remotes/origin/HEAD"]);
  if (symbolic.status === 0) {
    const remoteHead = symbolic.stdout.trim();
    if (remoteHead.startsWith("refs/remotes/origin/")) {
      const name = remoteHead.replace("refs/remotes/origin/", "");
      if (git(cwd, ["show-ref", "--verify", "--quiet", `refs/heads/${name}`]).status === 0) {
        return name;
      }
      return `origin/${name}`;
    }
  }

  for (const candidate of ["main", "master", "trunk"]) {
    if (git(cwd, ["show-ref", "--verify", "--quiet", `refs/heads/${candidate}`]).status === 0) {
      return candidate;
    }
    if (git(cwd, ["show-ref", "--verify", "--quiet", `refs/remotes/origin/${candidate}`]).status === 0) {
      return `origin/${candidate}`;
    }
  }

  throw new Error("Unable to detect the repository default branch. Pass --base <ref> or use --scope working-tree.");
}

export function getCurrentBranch(cwd) {
  return gitChecked(cwd, ["branch", "--show-current"]).stdout.trim() || "HEAD";
}

export function getWorkingTreeState(cwd) {
  const staged = gitChecked(cwd, ["diff", "--cached", "--name-only"]).stdout.trim().split("\n").filter(Boolean);
  const unstaged = gitChecked(cwd, ["diff", "--name-only"]).stdout.trim().split("\n").filter(Boolean);
  const untracked = gitChecked(cwd, ["ls-files", "--others", "--exclude-standard"]).stdout.trim().split("\n").filter(Boolean);
  return {
    staged,
    unstaged,
    untracked,
    isDirty: staged.length > 0 || unstaged.length > 0 || untracked.length > 0
  };
}

export function resolveReviewTarget(cwd, options = {}) {
  ensureGitRepository(cwd);
  const baseRef = options.base ?? null;
  const scope = options.scope ?? "auto";

  if (baseRef) {
    return { mode: "branch", label: `branch diff against ${baseRef}`, baseRef };
  }
  if (scope === "working-tree") {
    return { mode: "working-tree", label: "working tree diff" };
  }
  if (scope === "branch") {
    const detected = detectDefaultBranch(cwd);
    return { mode: "branch", label: `branch diff against ${detected}`, baseRef: detected };
  }
  if (scope !== "auto") {
    throw new Error(`Unsupported review scope "${scope}". Use auto, working-tree, or branch.`);
  }

  if (getWorkingTreeState(cwd).isDirty) {
    return { mode: "working-tree", label: "working tree diff" };
  }
  const detected = detectDefaultBranch(cwd);
  return { mode: "branch", label: `branch diff against ${detected}`, baseRef: detected };
}

function formatSection(title, body) {
  return [`## ${title}`, "", body.trim() ? body.trim() : "(none)", ""].join("\n");
}

function isProbablyText(buffer) {
  const sample = buffer.subarray(0, 8192);
  return !sample.includes(0);
}

function formatUntrackedFile(cwd, relativePath) {
  const absolutePath = path.join(cwd, relativePath);
  let stat;
  try {
    stat = fs.statSync(absolutePath);
  } catch {
    return `### ${relativePath}\n(skipped: unreadable file)`;
  }
  if (stat.isDirectory()) {
    return `### ${relativePath}\n(skipped: directory)`;
  }
  if (stat.size > MAX_UNTRACKED_BYTES) {
    return `### ${relativePath}\n(skipped: ${stat.size} bytes exceeds ${MAX_UNTRACKED_BYTES} byte limit)`;
  }
  let buffer;
  try {
    buffer = fs.readFileSync(absolutePath);
  } catch {
    return `### ${relativePath}\n(skipped: unreadable file)`;
  }
  if (!isProbablyText(buffer)) {
    return `### ${relativePath}\n(skipped: binary file)`;
  }
  return [`### ${relativePath}`, "```", buffer.toString("utf8").trimEnd(), "```"].join("\n");
}

function uniqueSorted(...groups) {
  return [...new Set(groups.flat().filter(Boolean))].sort();
}

export function collectReviewContext(cwd, target) {
  const repoRoot = ensureGitRepository(cwd);

  if (target.mode === "working-tree") {
    const state = getWorkingTreeState(repoRoot);
    const status = gitChecked(repoRoot, ["status", "--short", "--untracked-files=all"]).stdout.trim();
    const stagedDiff = gitChecked(repoRoot, ["diff", "--cached", "--no-ext-diff"]).stdout;
    const unstagedDiff = gitChecked(repoRoot, ["diff", "--no-ext-diff"]).stdout;
    const changedFiles = uniqueSorted(state.staged, state.unstaged, state.untracked);
    const diffBytes = Buffer.byteLength(stagedDiff, "utf8") + Buffer.byteLength(unstagedDiff, "utf8");
    const inline = diffBytes <= MAX_INLINE_DIFF_BYTES;
    const untrackedBody = state.untracked.map((file) => formatUntrackedFile(repoRoot, file)).join("\n\n");

    const parts = inline
      ? [
          formatSection("Git Status", status),
          formatSection("Staged Diff", stagedDiff),
          formatSection("Unstaged Diff", unstagedDiff),
          formatSection("Untracked Files", untrackedBody)
        ]
      : [
          formatSection("Git Status", status),
          formatSection("Staged Diff Stat", gitChecked(repoRoot, ["diff", "--shortstat", "--cached"]).stdout.trim()),
          formatSection("Unstaged Diff Stat", gitChecked(repoRoot, ["diff", "--shortstat"]).stdout.trim()),
          formatSection("Changed Files", changedFiles.join("\n"))
        ];

    return {
      mode: "working-tree",
      repoRoot,
      inputMode: inline ? "inline-diff" : "self-collect",
      summary: `Reviewing ${state.staged.length} staged, ${state.unstaged.length} unstaged, and ${state.untracked.length} untracked file(s).`,
      content: parts.join("\n"),
      changedFiles
    };
  }

  const mergeBase = gitChecked(repoRoot, ["merge-base", "HEAD", target.baseRef]).stdout.trim();
  const commitRange = `${mergeBase}..HEAD`;
  const changedFiles = gitChecked(repoRoot, ["diff", "--name-only", commitRange]).stdout.trim().split("\n").filter(Boolean);
  const logOutput = gitChecked(repoRoot, ["log", "--oneline", "--decorate", commitRange]).stdout.trim();
  const diffStat = gitChecked(repoRoot, ["diff", "--stat", commitRange]).stdout.trim();
  const branchDiff = gitChecked(repoRoot, ["diff", "--no-ext-diff", commitRange]).stdout;
  const inline = Buffer.byteLength(branchDiff, "utf8") <= MAX_INLINE_DIFF_BYTES;

  const parts = inline
    ? [formatSection("Commit Log", logOutput), formatSection("Diff Stat", diffStat), formatSection("Branch Diff", branchDiff)]
    : [formatSection("Commit Log", logOutput), formatSection("Diff Stat", diffStat), formatSection("Changed Files", changedFiles.join("\n"))];

  return {
    mode: "branch",
    repoRoot,
    inputMode: inline ? "inline-diff" : "self-collect",
    summary: `Reviewing branch ${getCurrentBranch(repoRoot)} against ${target.baseRef} from merge-base ${mergeBase}.`,
    content: parts.join("\n"),
    changedFiles
  };
}
