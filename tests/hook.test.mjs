import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HOOK = path.resolve(HERE, "..", "scripts", "stop-review-gate-hook.mjs");
const COMPANION = path.resolve(HERE, "..", "scripts", "agy-companion.mjs");
const FAKE_AGY = path.join(HERE, "fake-agy.mjs");

function makeDirtyRepo() {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "agy-hook-test-"));
  const run = (args) => {
    const result = spawnSync("git", args, { cwd: repo, encoding: "utf8" });
    if (result.status !== 0) {
      throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
    }
  };
  run(["init", "-b", "main"]);
  fs.writeFileSync(path.join(repo, "a.txt"), "one\n");
  run(["add", "."]);
  run(["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-m", "initial"]);
  fs.writeFileSync(path.join(repo, "a.txt"), "one\ntwo\n");
  return repo;
}

function hookEnv(dataDir, extra = {}) {
  return {
    ...process.env,
    CLAUDE_PLUGIN_DATA: dataDir,
    AGY_COMPANION_AGY_CMD: JSON.stringify([process.execPath, FAKE_AGY]),
    ...extra
  };
}

function runHook(repo, dataDir, stdinPayload, extraEnv = {}) {
  return spawnSync(process.execPath, [HOOK], {
    cwd: repo,
    encoding: "utf8",
    input: JSON.stringify(stdinPayload),
    env: hookEnv(dataDir, extraEnv)
  });
}

function enableGate(repo, dataDir) {
  const result = spawnSync(process.execPath, [COMPANION, "setup", "--enable-review-gate"], {
    cwd: repo,
    encoding: "utf8",
    env: hookEnv(dataDir)
  });
  assert.equal(result.status, 0, result.stderr);
}

test("gate disabled: hook exits 0 with no block output", () => {
  const repo = makeDirtyRepo();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "agy-data-"));
  const hook = runHook(repo, dataDir, { cwd: repo });
  assert.equal(hook.status, 0, hook.stderr);
  assert.doesNotMatch(hook.stdout, /"decision"/);
  fs.rmSync(repo, { recursive: true, force: true });
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test("gate enabled + needs-attention verdict: hook blocks with the review as reason", () => {
  const repo = makeDirtyRepo();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "agy-data-"));
  enableGate(repo, dataDir);

  const hook = runHook(repo, dataDir, { cwd: repo }, { FAKE_AGY_VERDICT: "needs-attention" });
  assert.equal(hook.status, 0, hook.stderr);
  const payload = JSON.parse(hook.stdout);
  assert.equal(payload.decision, "block");
  assert.match(payload.reason, /needs-attention/);

  fs.rmSync(repo, { recursive: true, force: true });
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test("gate enabled + approve verdict: hook does not block", () => {
  const repo = makeDirtyRepo();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "agy-data-"));
  enableGate(repo, dataDir);

  const hook = runHook(repo, dataDir, { cwd: repo });
  assert.equal(hook.status, 0, hook.stderr);
  assert.doesNotMatch(hook.stdout, /"decision"/);

  fs.rmSync(repo, { recursive: true, force: true });
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test("stop_hook_active short-circuits without running a review", () => {
  const repo = makeDirtyRepo();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "agy-data-"));
  enableGate(repo, dataDir);

  const hook = runHook(repo, dataDir, { cwd: repo, stop_hook_active: true }, { FAKE_AGY_VERDICT: "needs-attention" });
  assert.equal(hook.status, 0, hook.stderr);
  assert.doesNotMatch(hook.stdout, /"decision"/);

  fs.rmSync(repo, { recursive: true, force: true });
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test("clean working tree: hook exits 0 without reviewing", () => {
  const repo = makeDirtyRepo();
  fs.writeFileSync(path.join(repo, "a.txt"), "one\n"); // revert to clean
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "agy-data-"));
  enableGate(repo, dataDir);

  const hook = runHook(repo, dataDir, { cwd: repo }, { FAKE_AGY_VERDICT: "needs-attention" });
  assert.equal(hook.status, 0, hook.stderr);
  assert.doesNotMatch(hook.stdout, /"decision"/);

  fs.rmSync(repo, { recursive: true, force: true });
  fs.rmSync(dataDir, { recursive: true, force: true });
});
