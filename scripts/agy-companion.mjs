#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { parseArgs, splitRawArgumentString } from "./lib/args.mjs";
import {
  DEFAULT_MODEL,
  DEFAULT_PRINT_TIMEOUT,
  checkAgyAvailable,
  extractConversationId,
  killProcessTree,
  runAgy
} from "./lib/agy.mjs";
import { collectReviewContext, resolveReviewTarget, resolveWorkspaceRoot } from "./lib/git.mjs";
import {
  buildStatusSnapshot,
  readJobProgress,
  reapOrphanJobs,
  resolveCancelableJob,
  resolveResultJob,
  resolveResumeConversation,
  resolveStatusJob,
  waitForJob
} from "./lib/jobs.mjs";
import { interpolate, loadTemplate } from "./lib/prompts.mjs";
import {
  renderCancelReport,
  renderJobHeader,
  renderJobResult,
  renderSetupReport,
  renderStatusReport
} from "./lib/render.mjs";
import {
  generateJobId,
  getConfig,
  listJobs,
  readJobFile,
  resolveJobFile,
  resolveJobLogFile,
  setConfig,
  upsertJob,
  writeJobFile
} from "./lib/state.mjs";
import { ensureGitRepository } from "./lib/git.mjs";

const PLUGIN_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

const INLINE_GUIDANCE = "Use the repository context below as primary evidence.";
const SELF_COLLECT_GUIDANCE =
  "The repository context below is a lightweight summary. Open the listed changed files with your read tools and inspect them before finalizing findings.";
const TASK_PREAMBLE =
  "You are assisting from a non-interactive CLI. You may read files in the added directories with your read-only tools, but you cannot edit files or run terminal commands (those permission prompts are auto-denied — do not attempt them). If the task would require edits or command execution, describe the exact changes or commands instead of attempting them.";

function printUsage() {
  console.log(
    [
      "Usage:",
      '  node scripts/agy-companion.mjs review "[--base <ref>] [--scope auto|working-tree|branch] [--model <name>] [--timeout <dur>]"',
      '  node scripts/agy-companion.mjs adversarial-review "[same flags] [focus text]"',
      '  node scripts/agy-companion.mjs task "[--model <name>] [--timeout <dur>] [--resume | --conversation <id>] <prompt>"',
      '  node scripts/agy-companion.mjs status "[job-id] [--all] [--wait] [--timeout-ms <ms>]"',
      '  node scripts/agy-companion.mjs result "[job-id]"',
      '  node scripts/agy-companion.mjs cancel "[job-id]"',
      '  node scripts/agy-companion.mjs setup "[--enable-review-gate|--disable-review-gate]"'
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

function readConversationId(agyLogFile) {
  try {
    return extractConversationId(fs.readFileSync(agyLogFile, "utf8"));
  } catch {
    return null;
  }
}

async function executeJob({ workspaceRoot, jobId, kind, prompt, model, printTimeout, conversationId, jobFields = {} }) {
  const logFile = resolveJobLogFile(workspaceRoot, jobId);
  const agyLogFile = resolveJobFile(workspaceRoot, jobId).replace(/\.json$/, ".agy.log");
  // Windows caps a spawned process's argv around 32KB, so the assembled prompt
  // goes into a file that plan-mode agy reads itself.
  const promptFile = resolveJobFile(workspaceRoot, jobId).replace(/\.json$/, ".prompt.md");
  fs.writeFileSync(promptFile, prompt, "utf8");
  const pointerPrompt = `Read the file at ${promptFile} and follow the instructions in it exactly. That file contains your full task, output expectations, and context.`;

  upsertJob(workspaceRoot, {
    id: jobId,
    kind,
    status: "running",
    pid: process.pid,
    model,
    cwd: workspaceRoot,
    logFile,
    promptFile,
    agyLogFile,
    startedAt: new Date().toISOString(),
    ...jobFields
  });
  appendLog(logFile, `job ${jobId} started: ${kind}, model ${model}`);

  let result;
  try {
    result = await runAgy({
      prompt: pointerPrompt,
      addDirs: [workspaceRoot, path.dirname(promptFile)],
      model,
      printTimeout,
      logFile: agyLogFile,
      conversationId,
      onSpawn: (child) => {
        upsertJob(workspaceRoot, { id: jobId, agyPid: child.pid });
        appendLog(logFile, `agy started (pid ${child.pid})`);
      }
    });
  } catch (error) {
    // A synchronous spawn failure must not leave the job stuck in "running".
    const message = error instanceof Error ? error.message : String(error);
    upsertJob(workspaceRoot, { id: jobId, status: "failed", completedAt: new Date().toISOString(), summary: message });
    appendLog(logFile, `failed to spawn agy: ${message}`);
    throw error;
  }

  const latest = currentJob(workspaceRoot, jobId);
  if (latest?.status === "cancelled") {
    appendLog(logFile, "job was cancelled; keeping cancelled state");
    console.log(`Job ${jobId} was cancelled.`);
    return 0;
  }

  const completedAt = new Date().toISOString();
  const recordedConversationId = readConversationId(agyLogFile) ?? conversationId ?? undefined;
  writeJobFile(workspaceRoot, jobId, { output: result.stdout, stderr: result.stderr, exitStatus: result.status });

  // agy can exit 0 with no output at all (e.g. a tool permission was
  // auto-denied and it gave up) — that is a failure, not an empty success.
  if (result.status === 0 && !result.stdout.trim()) {
    const note = result.stderr.trim() || "agy produced no output";
    upsertJob(workspaceRoot, { id: jobId, status: "failed", completedAt, summary: note.slice(0, 200), conversationId: recordedConversationId });
    appendLog(logFile, `failed: empty output — ${note.slice(0, 200)}`);
    const job = currentJob(workspaceRoot, jobId);
    console.log(`${renderJobHeader(job)}\n`);
    console.log(`agy produced no output.\n\n${note}`);
    return 1;
  }

  if (result.status === 0) {
    const summary = extractSummary(result.stdout);
    upsertJob(workspaceRoot, { id: jobId, status: "completed", completedAt, summary, conversationId: recordedConversationId });
    appendLog(logFile, `completed: ${summary ?? "(no summary)"}`);
    const job = currentJob(workspaceRoot, jobId);
    console.log(`${renderJobHeader(job)}\n`);
    process.stdout.write(`${result.stdout.trimEnd()}\n`);
    return 0;
  }

  const failureNote = result.killed
    ? `agy exceeded the ${printTimeout} timeout and was terminated`
    : `agy exited with status ${result.status}`;
  upsertJob(workspaceRoot, { id: jobId, status: "failed", completedAt, summary: failureNote, conversationId: recordedConversationId });
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

async function runReviewJob(kind, rawArgs) {
  const { flags, text } = parseArgs(splitRawArgumentString(rawArgs));
  const workspaceRoot = resolveWorkspaceRoot(process.cwd());
  const target = resolveReviewTarget(workspaceRoot, { base: flags.base, scope: flags.scope });
  const context = collectReviewContext(workspaceRoot, target);
  const model = flags.model ?? DEFAULT_MODEL;
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

  return executeJob({
    workspaceRoot,
    jobId: generateJobId(kind === "adversarial-review" ? "adv" : "rev"),
    kind,
    prompt: interpolate(loadTemplate(PLUGIN_ROOT, templateName), vars),
    model,
    printTimeout: flags.timeout ?? DEFAULT_PRINT_TIMEOUT,
    jobFields: { targetLabel: target.label, focus: focus || undefined }
  });
}

async function runTaskJob(rawArgs) {
  const { flags, text } = parseArgs(splitRawArgumentString(rawArgs));
  if (!text.trim()) {
    throw new Error("task requires a prompt. Usage: task [--resume|--conversation <id>] [--model <name>] <prompt>");
  }
  const workspaceRoot = resolveWorkspaceRoot(process.cwd());
  const conversationId = flags.conversation ?? (flags.resume ? resolveResumeConversation(workspaceRoot) : undefined);

  return executeJob({
    workspaceRoot,
    jobId: generateJobId("task"),
    kind: "task",
    prompt: `${TASK_PREAMBLE}\n\nWorking directory: ${workspaceRoot}\n\nTask:\n${text.trim()}\n`,
    model: flags.model ?? DEFAULT_MODEL,
    printTimeout: flags.timeout ?? DEFAULT_PRINT_TIMEOUT,
    conversationId,
    jobFields: {}
  });
}

async function runStatus(rawArgs) {
  const { flags, text } = parseArgs(splitRawArgumentString(rawArgs));
  const reference = text.split(/\s+/).filter(Boolean)[0] ?? null;

  reapOrphanJobs(process.cwd());

  if (flags.wait) {
    const timeoutMs = flags["timeout-ms"] ? Number(flags["timeout-ms"]) : undefined;
    const { job, timedOut } = await waitForJob(process.cwd(), reference, { timeoutMs });
    if (timedOut) {
      console.log(`Job ${job.id} is still running after the wait timeout.\n`);
      console.log(renderStatusReport(buildStatusSnapshot(process.cwd(), { all: Boolean(flags.all) })));
      return 1;
    }
    const workspaceRoot = resolveWorkspaceRoot(process.cwd());
    const jobFile = resolveJobFile(workspaceRoot, job.id);
    const payload = fs.existsSync(jobFile) ? readJobFile(jobFile) : null;
    console.log(renderJobResult(job, payload ?? {}));
    return job.status === "failed" ? 1 : 0;
  }

  if (reference) {
    const { workspaceRoot, job } = resolveStatusJob(process.cwd(), reference);
    if (job.status === "running") {
      const progress = readJobProgress(job);
      const lines = [
        `${renderJobHeader(job)}`,
        "",
        `Status: running (${progress.phase})`,
        ...progress.lines.map((line) => `- ${line}`),
        "",
        `Wait for it with \`/agy-cli:status ${job.id} --wait\`, or cancel with \`/agy-cli:cancel ${job.id}\`.`
      ];
      console.log(lines.join("\n"));
      return 0;
    }
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

function runSetup(rawArgs) {
  const { flags } = parseArgs(splitRawArgumentString(rawArgs));
  const workspaceRoot = resolveWorkspaceRoot(process.cwd());

  if (flags["enable-review-gate"]) {
    setConfig(workspaceRoot, "stopReviewGate", true);
  }
  if (flags["disable-review-gate"]) {
    setConfig(workspaceRoot, "stopReviewGate", false);
  }

  let inGitRepo = true;
  try {
    ensureGitRepository(workspaceRoot);
  } catch {
    inGitRepo = false;
  }

  console.log(
    renderSetupReport({
      agyAvailable: checkAgyAvailable(),
      nodeVersion: process.version,
      inGitRepo,
      workspaceRoot,
      stopReviewGate: Boolean(getConfig(workspaceRoot).stopReviewGate)
    })
  );
  return 0;
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
      case "task":
        process.exitCode = await runTaskJob(rawArgs);
        return;
      case "status":
        process.exitCode = await runStatus(rawArgs);
        return;
      case "result":
        process.exitCode = runResult(rawArgs);
        return;
      case "cancel":
        process.exitCode = runCancel(rawArgs);
        return;
      case "setup":
        process.exitCode = runSetup(rawArgs);
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
