import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { parseDurationMs, runAgy } from "../scripts/lib/agy.mjs";
import { interpolate, loadTemplate } from "../scripts/lib/prompts.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FAKE_AGY = path.join(HERE, "fake-agy.mjs");
const PLUGIN_ROOT = path.resolve(HERE, "..");

function withFakeAgy(env, run) {
  const previous = { ...process.env };
  process.env.AGY_COMPANION_AGY_CMD = JSON.stringify([process.execPath, FAKE_AGY]);
  Object.assign(process.env, env);
  return run().finally(() => {
    for (const key of ["AGY_COMPANION_AGY_CMD", "FAKE_AGY_EXIT", "FAKE_AGY_SLEEP_MS"]) {
      if (previous[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = previous[key];
      }
    }
  });
}

test("parseDurationMs handles m/s/h suffixes", () => {
  assert.equal(parseDurationMs("10m"), 600000);
  assert.equal(parseDurationMs("45s"), 45000);
  assert.equal(parseDurationMs("1h"), 3600000);
  assert.throws(() => parseDurationMs("nope"), /duration/i);
});

test("interpolate replaces every placeholder occurrence", () => {
  const out = interpolate("A {{X}} B {{X}} C {{Y}}", { X: "1", Y: "2" });
  assert.equal(out, "A 1 B 1 C 2");
});

test("loadTemplate reads plugin prompt templates", () => {
  const template = loadTemplate(PLUGIN_ROOT, "review");
  assert.match(template, /\{\{REVIEW_INPUT\}\}/);
});

test("runAgy captures stdout and exit status from the binary", async () => {
  await withFakeAgy({}, async () => {
    const result = await runAgy({ prompt: "hi", addDir: PLUGIN_ROOT });
    assert.equal(result.status, 0);
    assert.match(result.stdout, /## Verdict/);
    assert.equal(result.killed, false);
  });
});

test("runAgy reports non-zero exits with stderr", async () => {
  await withFakeAgy({ FAKE_AGY_EXIT: "3" }, async () => {
    const result = await runAgy({ prompt: "hi", addDir: PLUGIN_ROOT });
    assert.equal(result.status, 3);
    assert.match(result.stderr, /simulated failure/);
  });
});

test("runAgy kill guard terminates an overrunning binary", async () => {
  await withFakeAgy({ FAKE_AGY_SLEEP_MS: "30000" }, async () => {
    const result = await runAgy({ prompt: "hi", addDir: PLUGIN_ROOT, printTimeout: "1s", killGraceMs: 200 });
    assert.equal(result.killed, true);
    assert.notEqual(result.status, 0);
  });
});
