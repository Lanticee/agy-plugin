import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { collectReviewContext, resolveReviewTarget } from "../scripts/lib/git.mjs";

function run(cwd, command, args) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", shell: false });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed: ${result.stderr}`);
  }
  return result.stdout;
}

function gitCommit(cwd, message) {
  run(cwd, "git", ["-c", "user.email=test@test", "-c", "user.name=test", "commit", "-m", message]);
}

function makeRepo() {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "agy-git-test-"));
  run(repo, "git", ["init", "-b", "main"]);
  fs.writeFileSync(path.join(repo, "a.txt"), "line one\n");
  run(repo, "git", ["add", "."]);
  gitCommit(repo, "initial");
  return repo;
}

test("resolveReviewTarget picks working tree when dirty", () => {
  const repo = makeRepo();
  fs.writeFileSync(path.join(repo, "a.txt"), "line one\nline two\n");
  const target = resolveReviewTarget(repo, {});
  assert.equal(target.mode, "working-tree");
  fs.rmSync(repo, { recursive: true, force: true });
});

test("resolveReviewTarget picks branch diff against default branch when clean", () => {
  const repo = makeRepo();
  run(repo, "git", ["checkout", "-b", "feature"]);
  fs.writeFileSync(path.join(repo, "b.txt"), "new file\n");
  run(repo, "git", ["add", "."]);
  gitCommit(repo, "add b");
  const target = resolveReviewTarget(repo, {});
  assert.equal(target.mode, "branch");
  assert.equal(target.baseRef, "main");
  fs.rmSync(repo, { recursive: true, force: true });
});

test("resolveReviewTarget honors explicit --base", () => {
  const repo = makeRepo();
  const target = resolveReviewTarget(repo, { base: "main" });
  assert.equal(target.mode, "branch");
  assert.equal(target.baseRef, "main");
  assert.match(target.label, /against main/);
  fs.rmSync(repo, { recursive: true, force: true });
});

test("collectReviewContext inlines a small working-tree diff with untracked files", () => {
  const repo = makeRepo();
  fs.writeFileSync(path.join(repo, "a.txt"), "line one\nchanged\n");
  fs.writeFileSync(path.join(repo, "new.txt"), "untracked content\n");
  const target = resolveReviewTarget(repo, {});
  const context = collectReviewContext(repo, target);
  assert.equal(context.inputMode, "inline-diff");
  assert.match(context.content, /## Git Status/);
  assert.match(context.content, /## Unstaged Diff/);
  assert.match(context.content, /## Untracked Files/);
  assert.match(context.content, /untracked content/);
  assert.ok(context.changedFiles.includes("a.txt"));
  fs.rmSync(repo, { recursive: true, force: true });
});

test("collectReviewContext falls back to self-collect for huge diffs", () => {
  const repo = makeRepo();
  fs.writeFileSync(path.join(repo, "big.txt"), "x".repeat(300 * 1024) + "\n");
  run(repo, "git", ["add", "big.txt"]);
  const target = resolveReviewTarget(repo, {});
  const context = collectReviewContext(repo, target);
  assert.equal(context.inputMode, "self-collect");
  assert.match(context.content, /## Changed Files/);
  assert.doesNotMatch(context.content, /xxxxxxxxxx/);
  fs.rmSync(repo, { recursive: true, force: true });
});

test("collectReviewContext builds branch context with log and diff", () => {
  const repo = makeRepo();
  run(repo, "git", ["checkout", "-b", "feature"]);
  fs.writeFileSync(path.join(repo, "b.txt"), "feature work\n");
  run(repo, "git", ["add", "."]);
  gitCommit(repo, "feature commit");
  const target = resolveReviewTarget(repo, { base: "main" });
  const context = collectReviewContext(repo, target);
  assert.equal(context.mode, "branch");
  assert.match(context.content, /## Commit Log/);
  assert.match(context.content, /feature commit/);
  assert.match(context.content, /feature work/);
  fs.rmSync(repo, { recursive: true, force: true });
});
