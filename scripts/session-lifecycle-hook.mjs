#!/usr/bin/env node
// Claude Code SessionStart/SessionEnd hook: mark orphaned agy jobs
// (status "running" but their companion process is dead) as failed, so
// /agy-cli:status never shows phantom running jobs from crashed or closed
// sessions. Always fail-open: any error exits 0 silently.

import process from "node:process";

import { reapOrphanJobs } from "./lib/jobs.mjs";

async function readStdin() {
  const chunks = [];
  try {
    for await (const chunk of process.stdin) {
      chunks.push(chunk);
    }
  } catch {
    return "{}";
  }
  return Buffer.concat(chunks).toString("utf8") || "{}";
}

async function main() {
  let payload = {};
  try {
    payload = JSON.parse(await readStdin());
  } catch {
    payload = {};
  }

  const cwd = typeof payload.cwd === "string" && payload.cwd ? payload.cwd : process.cwd();
  try {
    reapOrphanJobs(cwd);
  } catch {
    // fail-open
  }
}

await main();
