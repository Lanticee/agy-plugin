#!/usr/bin/env node
// Stand-in for the agy binary in tests. Ignores its arguments except --print.
const sleepMs = Number(process.env.FAKE_AGY_SLEEP_MS ?? 0);
const exitCode = Number(process.env.FAKE_AGY_EXIT ?? 0);
const hasPrint = process.argv.includes("--print");

setTimeout(() => {
  if (!hasPrint) {
    console.error("fake-agy: expected --print");
    process.exit(2);
  }
  if (exitCode === 0) {
    console.log("## Verdict");
    console.log("approve - fake review found nothing material.");
  } else {
    console.error("fake-agy: simulated failure");
  }
  process.exit(exitCode);
}, sleepMs);
