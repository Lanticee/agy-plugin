import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  generateJobId,
  listJobs,
  loadState,
  resolveJobFile,
  resolveStateDir,
  upsertJob,
  writeJobFile,
  readJobFile,
  saveState
} from "../scripts/lib/state.mjs";

function withTempStateRoot(run) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "agy-state-test-"));
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

test("resolveStateDir is stable per workspace and under CLAUDE_PLUGIN_DATA", () => {
  withTempStateRoot((dataDir) => {
    const first = resolveStateDir(process.cwd());
    const second = resolveStateDir(process.cwd());
    assert.equal(first, second);
    assert.ok(first.startsWith(path.join(dataDir, "state")));
  });
});

test("upsertJob creates then updates a job with timestamps", () => {
  withTempStateRoot(() => {
    const id = generateJobId("task");
    upsertJob(process.cwd(), { id, kind: "review", status: "running" });
    let jobs = listJobs(process.cwd());
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].status, "running");
    assert.ok(jobs[0].createdAt);

    upsertJob(process.cwd(), { id, status: "completed", summary: "ok" });
    jobs = listJobs(process.cwd());
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].status, "completed");
    assert.equal(jobs[0].summary, "ok");
    assert.equal(jobs[0].kind, "review");
  });
});

test("saveState prunes to 50 newest jobs and removes their files", () => {
  withTempStateRoot(() => {
    const cwd = process.cwd();
    for (let index = 0; index < 55; index += 1) {
      const id = `task-${String(index).padStart(3, "0")}`;
      upsertJob(cwd, { id, kind: "review", status: "completed", updatedAt: new Date(2026, 0, 1, 0, index).toISOString() });
      writeJobFile(cwd, id, { output: `result ${index}` });
    }
    const jobs = listJobs(cwd);
    assert.equal(jobs.length, 50);
    const oldestKeptIds = new Set(jobs.map((job) => job.id));
    assert.ok(!oldestKeptIds.has("task-000"));
    assert.ok(!fs.existsSync(resolveJobFile(cwd, "task-000")));
  });
});

test("writeJobFile round-trips payloads", () => {
  withTempStateRoot(() => {
    const cwd = process.cwd();
    const file = writeJobFile(cwd, "task-x", { output: "## Verdict\napprove" });
    assert.deepEqual(readJobFile(file), { output: "## Verdict\napprove" });
  });
});

test("loadState tolerates corrupt state files", () => {
  withTempStateRoot(() => {
    const cwd = process.cwd();
    upsertJob(cwd, { id: "task-y", kind: "review", status: "running" });
    const stateFile = path.join(resolveStateDir(cwd), "state.json");
    fs.writeFileSync(stateFile, "{not json", "utf8");
    const state = loadState(cwd);
    assert.deepEqual(state.jobs, []);
    saveState(cwd, state);
  });
});
