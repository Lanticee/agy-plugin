#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { parseArgs, splitRawArgumentString } from "./lib/args.mjs";
import { DEFAULT_MODEL, DEFAULT_PRINT_TIMEOUT, killProcessTree, runAgy } from "./lib/agy.mjs";
import { collectReviewContext, resolveReviewTarget, resolveWorkspaceRoot } from "./lib/git.mjs";
import {
  buildStatusSnapshot,
  resolveCancelableJob,
  resolveResultJob,
  resolveStatusJob
} from "./lib/jobs.mjs";
import { interpolate, loadTemplate } from "./lib/prompts.mjs";
import { renderCancelReport, renderJobHeader, renderJobResult, renderStatusReport } from "./lib/render.mjs";
import {
  generateJobId,
  listJobs,
  readJobFile,
  resolveJobFile,
  resolveJobLogFile,
  upsertJob,
  writeJobFile
} from "./lib/state.mjs";

const PLUGIN_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

const INLINE_GUIDANCE = "Use the repository context below as primary evidence.";
const SELF_COLLECT_GUIDANCE =
  "The repository context below is a lightweight summary. Open the listed changed files with your read tools and inspect them before finalizing findings.";

function printUsage() {
  console.log(
    [
      "Usage:",
      '  node scripts/agy-companion.mjs review "[--base <ref>] [--scope auto|working-tree|branch] [--model <name>] [--timeout <dur>]"',
      '  node scripts/agy-companion.mjs adversarial-review "[same flags] [focus text]"',
      '  node scripts/agy-companion.mjs status "[job-id] [--all]"',
      '  node scripts/agy-companion.mjs result "[job-id]"',
      '  node scripts/agy-companion.mjs cancel "[job-id]"'
    ].join("\n")
  );
}

function appendLog(logFile, message) {
  try {
    fs.appendFileSync(logFile, `[${new Date().toISOString()}] ${message}\n`, "utf8");
  } catch {
    // logging must never break the job
  }
}

function extractSummary(output) {
  const lines = String(output ?? "").split(/\r?\n/);
  const verdictIndex = lines.findIndex((line) => line.trim().toLowerCase() === "## verdict");
  if (verdictIndex !== -1) {
    for (let index = verdictIndex + 1; index < lines.length; index += 1) {
      const trimmed = lines[index].trim();
      if (trimmed) {
        return trimmed.slice(0, 200);
      }
    }
  }
  const firstNonEmpty = lines.find((line) => line.trim());
  return firstNonEmpty ? firstNonEmpty.trim().slice(0, 200) : null;
}

function currentJob(workspaceRoot, jobId) {
  return listJobs(workspaceRoot).find((job) => job.id === jobId) ?? null;
}

async function runReviewJob(kind, rawArgs) {
  const { flags, text } = parseArgs(splitRawArgumentString(rawArgs));
  const workspaceRoot = resolveWorkspaceRoot(process.cwd());
  const target = resolveReviewTarget(workspaceRoot, { base: flags.base, scope: flags.scope });
  const context = collectReviewContext(workspaceRoot, target);
  const model = flags.model ?? DEFAULT_MODEL;
  const printTimeout = flags.timeout ?? DEFAULT_PRINT_TIMEOUT;
  const focus = kind === "adversarial-review" ? text : "";

  const templateName = kind === "adversarial-review" ? "adversarial-review" : "review";
  const vars = {
    TARGET_LABEL: target.label,
    REVIEW_INPUT: context.content,
    COLLECTION_GUIDANCE: context.inputMode === "inline-diff" ? INLINE_GUIDANCE : SELF_COLLECT_GUIDANCE
  };
  if (kind === "adversarial-review") {
    vars.USER_FOCUS = focus || "(none — general adversarial review)";
  }
  const prompt = interpolate(loadTemplate(PLUGIN_ROOT, templateName), vars);

  const jobId = generateJobId(kind === "adversarial-review" ? "adv" : "rev");
  const logFile = resolveJobLogFile(workspaceRoot, jobId);
  const startedAt = new Date().toISOString();

  // Windows caps a spawned process's argv around 32KB, so the assembled prompt
  // (which embeds the diff) goes into a file that plan-mode agy reads itself.
  const promptFile = resolveJobFile(workspaceRoot, jobId).replace(/\.json$/, ".prompt.md");
  fs.writeFileSync(promptFile, prompt, "utf8");
  const pointerPrompt = `Read the file at ${promptFile} and follow the instructions in it exactly. That file contains your full review task, output contract, and repository context.`;

  upsertJob(workspaceRoot, {
    id: jobId,
    kind,
    status: "running",
    pid: process.pid,
    model,
    targetLabel: target.label,
    focus: focus || undefined,
    cwd: workspaceRoot,
    logFile,
    promptFile,
    startedAt
  });
  appendLog(logFile, `job ${jobId} started: ${kind}, ${target.label}, model ${model}`);
  appendLog(logFile, context.summary);

  const result = await runAgy({
    prompt: pointerPrompt,
    addDirs: [workspaceRoot, path.dirname(promptFile)],
    model,
    printTimeout,
    onSpawn: (child) => {
      upsertJob(workspaceRoot, { id: jobId, agyPid: child.pid });
      appendLog(logFile, `agy started (pid ${child.pid})`);
    }
  });

  const latest = currentJob(workspaceRoot, jobId);
  if (latest?.status === "cancelled") {
    appendLog(logFile, "job was cancelled; keeping cancelled state");
    console.log(`Job ${jobId} was cancelled.`);
    return 0;
  }

  const completedAt = new Date().toISOString();
  writeJobFile(workspaceRoot, jobId, { output: result.stdout, stderr: result.stderr, exitStatus: result.status });

  if (result.status === 0) {
    const summary = extractSummary(result.stdout);
    upsertJob(workspaceRoot, { id: jobId, status: "completed", completedAt, summary });
    appendLog(logFile, `completed: ${summary ?? "(no summary)"}`);
    const job = currentJob(workspaceRoot, jobId);
    console.log(`${renderJobHeader(job)}\n`);
    process.stdout.write(`${result.stdout.trimEnd()}\n`);
    return 0;
  }

  const failureNote = result.killed
    ? `agy exceeded the ${printTimeout} timeout and was terminated`
    : `agy exited with status ${result.status}`;
  upsertJob(workspaceRoot, { id: jobId, status: "failed", completedAt, summary: failureNote });
  appendLog(logFile, `failed: ${failureNote}`);
  const job = currentJob(workspaceRoot, jobId);
  console.log(`${renderJobHeader(job)}\n`);
  console.log(`${failureNote}.`);
  if (result.stderr.trim()) {
    console.log(`\nstderr:\n${result.stderr.trim()}`);
  }
  if (result.stdout.trim()) {
    console.log(`\npartial output:\n${result.stdout.trimEnd()}`);
  }
  return 1;
}

function runStatus(rawArgs) {
  const { flags, text } = parseArgs(splitRawArgumentString(rawArgs));
  const reference = text.split(/\s+/).filter(Boolean)[0] ?? null;

  if (reference) {
    const { workspaceRoot, job } = resolveStatusJob(process.cwd(), reference);
    const jobFile = resolveJobFile(workspaceRoot, job.id);
    const payload = fs.existsSync(jobFile) ? readJobFile(jobFile) : null;
    console.log(renderJobResult(job, payload ?? {}));
    return 0;
  }

  console.log(renderStatusReport(buildStatusSnapshot(process.cwd(), { all: Boolean(flags.all) })));
  return 0;
}

function runResult(rawArgs) {
  const { text } = parseArgs(splitRawArgumentString(rawArgs));
  const reference = text.split(/\s+/).filter(Boolean)[0] ?? null;
  const { workspaceRoot, job } = resolveResultJob(process.cwd(), reference);
  const jobFile = resolveJobFile(workspaceRoot, job.id);
  const payload = fs.existsSync(jobFile) ? readJobFile(jobFile) : null;
  console.log(renderJobResult(job, payload ?? {}));
  return job.status === "failed" ? 1 : 0;
}

function runCancel(rawArgs) {
  const { text } = parseArgs(splitRawArgumentString(rawArgs));
  const reference = text.split(/\s+/).filter(Boolean)[0] ?? null;
  const { workspaceRoot, job } = resolveCancelableJob(process.cwd(), reference);

  upsertJob(workspaceRoot, { id: job.id, status: "cancelled", completedAt: new Date().toISOString() });
  if (job.agyPid) {
    killProcessTree(job.agyPid);
  }
  if (job.pid && job.pid !== process.pid) {
    killProcessTree(job.pid);
  }
  console.log(renderCancelReport(job));
  return 0;
}

async function main() {
  const [, , subcommand, ...rest] = process.argv;
  // Slash commands pass "$ARGUMENTS" as one string (inner quotes intact) — re-tokenize it.
  // Direct shell calls arrive pre-split by the shell — re-joining would shred quoted values.
  const rawArgs = rest.length === 1 ? rest[0] : rest.map((token) => (/\s/.test(token) ? `"${token}"` : token)).join(" ");

  try {
    switch (subcommand) {
      case "review":
      case "adversarial-review":
        process.exitCode = await runReviewJob(subcommand, rawArgs);
        return;
      case "status":
        process.exitCode = runStatus(rawArgs);
        return;
      case "result":
        process.exitCode = runResult(rawArgs);
        return;
      case "cancel":
        process.exitCode = runCancel(rawArgs);
        return;
      default:
        printUsage();
        process.exitCode = subcommand ? 1 : 0;
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

await main();
