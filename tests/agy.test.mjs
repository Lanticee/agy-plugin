import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import fs from "node:fs";
import os from "node:os";

import { extractConversationId, parseDurationMs, runAgy } from "../scripts/lib/agy.mjs";
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

test("extractConversationId parses Created-conversation lines", () => {
  const log = 'I0724 08:38:36 server.go:917] Created conversation d10bca0b-14b1-48fe-aaef-69303fd62bed\n';
  assert.equal(extractConversationId(log), "d10bca0b-14b1-48fe-aaef-69303fd62bed");
});

test("extractConversationId falls back to the print-mode conversationID field", () => {
  const log = 'I0724 08:38:33 printmode.go:108] Print mode: starting (promptLength=27, model="x", conversationID="11111111-2222-3333-4444-555555555555")\n';
  assert.equal(extractConversationId(log), "11111111-2222-3333-4444-555555555555");
  assert.equal(extractConversationId('printmode.go] Print mode: starting (conversationID="")'), null);
  assert.equal(extractConversationId(""), null);
});

test("runAgy writes an agy log with a conversation id when logFile is set", async () => {
  await withFakeAgy({}, async () => {
    const logFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "agy-log-")), "run.log");
    const result = await runAgy({ prompt: "hi", addDir: PLUGIN_ROOT, logFile });
    assert.equal(result.status, 0);
    const id = extractConversationId(fs.readFileSync(logFile, "utf8"));
    assert.equal(id, "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
  });
});

test("runAgy passes --conversation when conversationId is set", async () => {
  await withFakeAgy({}, async () => {
    const argsFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "agy-args-")), "args.json");
    process.env.FAKE_AGY_ARGS_FILE = argsFile;
    try {
      await runAgy({ prompt: "hi", addDir: PLUGIN_ROOT, conversationId: "12345678-1234-1234-1234-123456789abc" });
      const args = JSON.parse(fs.readFileSync(argsFile, "utf8"));
      const index = args.indexOf("--conversation");
      assert.notEqual(index, -1);
      assert.equal(args[index + 1], "12345678-1234-1234-1234-123456789abc");
    } finally {
      delete process.env.FAKE_AGY_ARGS_FILE;
    }
  });
});

test("runAgy kill guard terminates an overrunning binary", async () => {
  await withFakeAgy({ FAKE_AGY_SLEEP_MS: "30000" }, async () => {
    const result = await runAgy({ prompt: "hi", addDir: PLUGIN_ROOT, printTimeout: "1s", killGraceMs: 200 });
    assert.equal(result.killed, true);
    assert.notEqual(result.status, 0);
  });
});
