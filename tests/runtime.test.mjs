import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const COMPANION = path.resolve(HERE, "..", "scripts", "agy-companion.mjs");
const FAKE_AGY = path.join(HERE, "fake-agy.mjs");

function makeRepo() {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "agy-runtime-test-"));
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

function companionEnv(repo, dataDir, extra = {}) {
  return {
    ...process.env,
    CLAUDE_PLUGIN_DATA: dataDir,
    AGY_COMPANION_AGY_CMD: JSON.stringify([process.execPath, FAKE_AGY]),
    ...extra
  };
}

function runCompanion(repo, dataDir, args, extraEnv = {}) {
  return spawnSync(process.execPath, [COMPANION, ...args], {
    cwd: repo,
    encoding: "utf8",
    env: companionEnv(repo, dataDir, extraEnv)
  });
}

async function loadJobs(repo, dataDir) {
  const previous = process.env.CLAUDE_PLUGIN_DATA;
  process.env.CLAUDE_PLUGIN_DATA = dataDir;
  try {
    const { listJobs } = await import("../scripts/lib/state.mjs");
    return listJobs(repo);
  } finally {
    if (previous === undefined) {
      delete process.env.CLAUDE_PLUGIN_DATA;
    } else {
      process.env.CLAUDE_PLUGIN_DATA = previous;
    }
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test("review runs to completion, records a job, and status/result read it back", async () => {
  const repo = makeRepo();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "agy-data-"));

  const review = runCompanion(repo, dataDir, ["review", ""]);
  assert.equal(review.status, 0, review.stderr);
  assert.match(review.stdout, /## Verdict/);
  assert.match(review.stdout, /Gemini review via agy/);

  const jobs = await loadJobs(repo, dataDir);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].status, "completed");
  assert.equal(jobs[0].kind, "review");
  assert.match(jobs[0].summary ?? "", /approve/);

  const status = runCompanion(repo, dataDir, ["status", ""]);
  assert.equal(status.status, 0, status.stderr);
  assert.match(status.stdout, new RegExp(jobs[0].id));

  const result = runCompanion(repo, dataDir, ["result", ""]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /## Verdict/);

  fs.rmSync(repo, { recursive: true, force: true });
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test("adversarial-review passes focus text and records kind", async () => {
  const repo = makeRepo();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "agy-data-"));

  const review = runCompanion(repo, dataDir, ["adversarial-review", "look for race conditions"]);
  assert.equal(review.status, 0, review.stderr);
  assert.match(review.stdout, /adversarial/i);

  const jobs = await loadJobs(repo, dataDir);
  assert.equal(jobs[0].kind, "adversarial-review");

  fs.rmSync(repo, { recursive: true, force: true });
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test("failed agy runs are recorded as failed and surface stderr", async () => {
  const repo = makeRepo();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "agy-data-"));

  const review = runCompanion(repo, dataDir, ["review", ""], { FAKE_AGY_EXIT: "3" });
  assert.notEqual(review.status, 0);
  assert.match(review.stdout + review.stderr, /simulated failure/);

  const jobs = await loadJobs(repo, dataDir);
  assert.equal(jobs[0].status, "failed");

  fs.rmSync(repo, { recursive: true, force: true });
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test("cancel kills a running job and the runner does not overwrite the cancelled state", async () => {
  const repo = makeRepo();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "agy-data-"));

  const child = spawn(process.execPath, [COMPANION, "review", ""], {
    cwd: repo,
    env: companionEnv(repo, dataDir, { FAKE_AGY_SLEEP_MS: "8000" }),
    stdio: "ignore"
  });

  let jobs = [];
  for (let attempt = 0; attempt < 50; attempt += 1) {
    jobs = await loadJobs(repo, dataDir);
    if (jobs.length > 0 && jobs[0].agyPid) {
      break;
    }
    await sleep(200);
  }
  assert.ok(jobs.length > 0 && jobs[0].agyPid, "job never reached running state with agyPid");

  const cancel = runCompanion(repo, dataDir, ["cancel", ""]);
  assert.equal(cancel.status, 0, cancel.stderr);
  assert.match(cancel.stdout, /cancel/i);

  await sleep(1500);
  jobs = await loadJobs(repo, dataDir);
  assert.equal(jobs[0].status, "cancelled");

  child.kill();
  fs.rmSync(repo, { recursive: true, force: true });
  fs.rmSync(dataDir, { recursive: true, force: true });
});
