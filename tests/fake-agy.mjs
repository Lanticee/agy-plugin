#!/usr/bin/env node
// Stand-in for the agy binary in tests.
import fs from "node:fs";

const sleepMs = Number(process.env.FAKE_AGY_SLEEP_MS ?? 0);
const exitCode = Number(process.env.FAKE_AGY_EXIT ?? 0);
const hasPrint = process.argv.includes("--print");

function argValue(flag) {
  const index = process.argv.indexOf(flag);
  return index !== -1 && index + 1 < process.argv.length ? process.argv[index + 1] : null;
}

if (process.argv.includes("--help")) {
  console.log("Usage of fake-agy");
  process.exit(0);
}

if (process.env.FAKE_AGY_ARGS_FILE) {
  fs.writeFileSync(process.env.FAKE_AGY_ARGS_FILE, JSON.stringify(process.argv.slice(2)), "utf8");
}

const logFile = argValue("--log-file");
if (logFile) {
  const conversationId = argValue("--conversation") ?? "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
  const line = argValue("--conversation")
    ? `I0724 00:00:00.000000 1 printmode.go:108] Print mode: starting (promptLength=1, model="fake", conversationID="${conversationId}")\n`
    : `I0724 00:00:00.000000 1 server.go:917] Created conversation ${conversationId}\n`;
  fs.writeFileSync(logFile, line, "utf8");
}

setTimeout(() => {
  if (!hasPrint) {
    console.error("fake-agy: expected --print");
    process.exit(2);
  }
  if (process.env.FAKE_AGY_EMPTY === "1") {
    console.error("jetski: no output produced — a tool required the \"command\" permission");
    process.exit(0);
  }
  if (exitCode === 0) {
    const verdict = process.env.FAKE_AGY_VERDICT ?? "approve";
    console.log("## Verdict");
    console.log(`${verdict} - fake review verdict.`);
    if (process.env.FAKE_AGY_MACHINE_VERDICT === "1") {
      console.log(`VERDICT: ${verdict.replace(/[^a-z-]/gi, "")}`);
    }
  } else {
    console.error("fake-agy: simulated failure");
  }
  process.exit(exitCode);
}, sleepMs);
