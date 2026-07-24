#!/usr/bin/env node
// Claude Code Stop hook: when the review gate is enabled, run a Gemini review
// of the dirty working tree and block the stop on a needs-attention verdict.
// Every failure path is fail-open (exit 0) — the gate must never wedge a session.

import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { getWorkingTreeState, resolveWorkspaceRoot } from "./lib/git.mjs";
import { getConfig } from "./lib/state.mjs";

const COMPANION = path.join(path.dirname(fileURLToPath(import.meta.url)), "agy-companion.mjs");

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

function extractVerdict(reviewOutput) {
  const lines = String(reviewOutput ?? "").split(/\r?\n/);
  const verdictIndex = lines.findIndex((line) => line.trim().toLowerCase() === "## verdict");
  if (verdictIndex === -1) {
    return null;
  }
  for (let index = verdictIndex + 1; index < lines.length; index += 1) {
    const trimmed = lines[index].trim();
    if (trimmed) {
      return trimmed;
    }
  }
  return null;
}

async function main() {
  let payload = {};
  try {
    payload = JSON.parse(await readStdin());
  } catch {
    payload = {};
  }

  // Never block twice in the same stop chain — that risks an endless review loop.
  if (payload.stop_hook_active) {
    return;
  }

  const cwd = typeof payload.cwd === "string" && payload.cwd ? payload.cwd : process.cwd();
  const workspaceRoot = resolveWorkspaceRoot(cwd);

  if (!getConfig(workspaceRoot).stopReviewGate) {
    return;
  }

  let dirty = false;
  try {
    dirty = getWorkingTreeState(workspaceRoot).isDirty;
  } catch {
    return;
  }
  if (!dirty) {
    return;
  }

  const review = spawnSync(process.execPath, [COMPANION, "review", "--wait --scope working-tree"], {
    cwd: workspaceRoot,
    encoding: "utf8",
    windowsHide: true,
    timeout: 840000,
    maxBuffer: 64 * 1024 * 1024
  });

  if (review.status !== 0) {
    return;
  }

  const verdict = extractVerdict(review.stdout);
  if (!verdict || !verdict.toLowerCase().startsWith("needs-attention")) {
    return;
  }

  console.log(
    JSON.stringify({
      decision: "block",
      reason: `The agy review gate found issues in the working tree. Address the material findings below (or ask the user to disable the gate with /agy-cli:setup --disable-review-gate).\n\n${review.stdout.trim()}`
    })
  );
}

await main();
