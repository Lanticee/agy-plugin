import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { isPidAlive, readJobProgress, reapOrphanJobs } from "../scripts/lib/jobs.mjs";
import { listJobs, upsertJob } from "../scripts/lib/state.mjs";

function withTempStateRoot(run) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "agy-jobs-test-"));
  const previous = process.env.CLAUDE_PLUGIN_DATA;
  process.env.CLAUDE_PLUGIN_DATA = dataDir;
  try {
    return run(dataDir);
  } finally {
    if (previous === undefined) {
      delete process.env.CLAUDE_PLUGIN_DATA;
    } else {
      process.env.CLAUDE_PLUGIN_DATA = previous;
    }
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

test("isPidAlive distinguishes our own process from a dead pid", () => {
  assert.equal(isPidAlive(process.pid), true);
  assert.equal(isPidAlive(4000000), false);
  assert.equal(isPidAlive(null), false);
});

test("reapOrphanJobs marks running jobs with dead pids as failed", () => {
  withTempStateRoot(() => {
    const cwd = process.cwd();
    upsertJob(cwd, { id: "task-dead", kind: "task", status: "running", pid: 4000000 });
    upsertJob(cwd, { id: "task-alive", kind: "task", status: "running", pid: process.pid });
    upsertJob(cwd, { id: "task-done", kind: "task", status: "completed", pid: 4000001 });

    const reaped = reapOrphanJobs(cwd);
    assert.deepEqual(reaped, ["task-dead"]);

    const jobs = listJobs(cwd);
    assert.equal(jobs.find((job) => job.id === "task-dead").status, "failed");
    assert.match(jobs.find((job) => job.id === "task-dead").summary, /orphaned/i);
    assert.equal(jobs.find((job) => job.id === "task-alive").status, "running");
    assert.equal(jobs.find((job) => job.id === "task-done").status, "completed");
  });
});

test("readJobProgress maps agy log milestones to phases", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agy-progress-"));
  const logFile = path.join(dir, "run.agy.log");

  fs.writeFileSync(logFile, "I0724 1 printmode.go:108] Print mode: starting (promptLength=1)\n");
  assert.equal(readJobProgress({ agyLogFile: logFile }).phase, "starting");

  fs.appendFileSync(logFile, "I0724 1 server.go:1] Sending user message to conversation abc\n");
  const generating = readJobProgress({ agyLogFile: logFile });
  assert.equal(generating.phase, "generating");
  assert.ok(generating.lines.length > 0);

  fs.appendFileSync(logFile, "I0724 1 server.go:2] Stream completed for abc\n");
  assert.equal(readJobProgress({ agyLogFile: logFile }).phase, "finalizing");

  assert.equal(readJobProgress({ agyLogFile: path.join(dir, "missing.log") }).phase, "starting");
  assert.equal(readJobProgress({}).phase, "starting");

  fs.rmSync(dir, { recursive: true, force: true });
});
