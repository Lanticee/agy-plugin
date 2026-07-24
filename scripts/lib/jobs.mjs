import fs from "node:fs";

import { listJobs, upsertJob } from "./state.mjs";
import { resolveWorkspaceRoot } from "./git.mjs";

const DEFAULT_MAX_STATUS_JOBS = 8;

export function sortJobsNewestFirst(jobs) {
  return [...jobs].sort((left, right) => String(right.updatedAt ?? "").localeCompare(String(left.updatedAt ?? "")));
}

export function formatElapsed(startValue, endValue = null) {
  const start = Date.parse(startValue ?? "");
  if (!Number.isFinite(start)) {
    return null;
  }
  const end = endValue ? Date.parse(endValue) : Date.now();
  if (!Number.isFinite(end) || end < start) {
    return null;
  }
  const totalSeconds = Math.max(0, Math.round((end - start) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

export function matchJobReference(jobs, reference, predicate = () => true) {
  const filtered = jobs.filter(predicate);
  if (!reference) {
    return filtered[0] ?? null;
  }
  const exact = filtered.find((job) => job.id === reference);
  if (exact) {
    return exact;
  }
  const prefixMatches = filtered.filter((job) => job.id.startsWith(reference));
  if (prefixMatches.length === 1) {
    return prefixMatches[0];
  }
  if (prefixMatches.length > 1) {
    throw new Error(`Job reference "${reference}" is ambiguous. Use a longer job id.`);
  }
  return null;
}

export function buildStatusSnapshot(cwd, options = {}) {
  const workspaceRoot = resolveWorkspaceRoot(cwd);
  const jobs = sortJobsNewestFirst(listJobs(workspaceRoot));
  const maxJobs = options.maxJobs ?? DEFAULT_MAX_STATUS_JOBS;

  const running = jobs
    .filter((job) => job.status === "running")
    .map((job) => ({ ...job, phase: readJobProgress(job).phase }));
  const finished = jobs.filter((job) => job.status !== "running");
  const recent = options.all ? finished : finished.slice(0, maxJobs);

  return { workspaceRoot, running, recent };
}

export function resolveStatusJob(cwd, reference) {
  const workspaceRoot = resolveWorkspaceRoot(cwd);
  const job = matchJobReference(sortJobsNewestFirst(listJobs(workspaceRoot)), reference);
  if (!job) {
    throw new Error(`No job found for "${reference}". Run /agy-cli:status to list known jobs.`);
  }
  return { workspaceRoot, job };
}

export function resolveResultJob(cwd, reference) {
  const workspaceRoot = resolveWorkspaceRoot(cwd);
  const jobs = sortJobsNewestFirst(listJobs(workspaceRoot));
  const finished = matchJobReference(jobs, reference, (job) => job.status !== "running");
  if (finished) {
    return { workspaceRoot, job: finished };
  }

  const active = matchJobReference(jobs, reference, (job) => job.status === "running");
  if (active) {
    throw new Error(`Job ${active.id} is still running. Check /agy-cli:status and try again once it finishes.`);
  }
  if (reference) {
    throw new Error(`No job found for "${reference}". Run /agy-cli:status to list known jobs.`);
  }
  throw new Error("No finished agy jobs found for this repository yet.");
}

export function isPidAlive(pid) {
  if (!pid) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means the process exists but we lack permission to signal it.
    return error?.code === "EPERM";
  }
}

export function reapOrphanJobs(cwd) {
  const workspaceRoot = resolveWorkspaceRoot(cwd);
  const reaped = [];
  for (const job of listJobs(workspaceRoot)) {
    if (job.status === "running" && !isPidAlive(job.pid)) {
      upsertJob(workspaceRoot, {
        id: job.id,
        status: "failed",
        completedAt: new Date().toISOString(),
        summary: "orphaned — process no longer running"
      });
      reaped.push(job.id);
    }
  }
  return reaped;
}

const PROGRESS_MILESTONES = [
  { pattern: /Print mode: starting/, label: "agy started", phase: "starting" },
  { pattern: /Created conversation|Starting new conversation/, label: "conversation created", phase: "starting" },
  { pattern: /Sending user message/, label: "prompt sent to Gemini", phase: "generating" },
  { pattern: /Streaming conversation/, label: "Gemini responding", phase: "generating" },
  { pattern: /Stream completed/, label: "response complete", phase: "finalizing" }
];

export function readJobProgress(job) {
  const fallback = { phase: "starting", lines: [] };
  if (!job?.agyLogFile) {
    return fallback;
  }
  let text;
  try {
    text = fs.readFileSync(job.agyLogFile, "utf8");
  } catch {
    return fallback;
  }

  let phase = "starting";
  const lines = [];
  for (const line of text.split(/\r?\n/)) {
    for (const milestone of PROGRESS_MILESTONES) {
      if (milestone.pattern.test(line)) {
        phase = milestone.phase;
        if (lines[lines.length - 1] !== milestone.label) {
          lines.push(milestone.label);
        }
        break;
      }
    }
  }
  return { phase, lines: lines.slice(-4) };
}

export async function waitForJob(cwd, reference, options = {}) {
  const workspaceRoot = resolveWorkspaceRoot(cwd);
  const timeoutMs = options.timeoutMs ?? 240000;
  const pollMs = options.pollMs ?? 2000;
  const deadline = Date.now() + timeoutMs;

  const findTarget = () => {
    const jobs = sortJobsNewestFirst(listJobs(workspaceRoot));
    if (reference) {
      return matchJobReference(jobs, reference);
    }
    return jobs.find((job) => job.status === "running") ?? jobs[0] ?? null;
  };

  let target = findTarget();
  if (!target) {
    throw new Error(reference ? `No job found for "${reference}".` : "No agy jobs recorded for this repository yet.");
  }

  while (true) {
    reapOrphanJobs(workspaceRoot);
    const current = sortJobsNewestFirst(listJobs(workspaceRoot)).find((job) => job.id === target.id) ?? target;
    if (current.status !== "running") {
      return { job: current, timedOut: false };
    }
    if (Date.now() >= deadline) {
      return { job: current, timedOut: true };
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}

export function resolveResumeConversation(cwd) {
  const workspaceRoot = resolveWorkspaceRoot(cwd);
  const withConversation = sortJobsNewestFirst(listJobs(workspaceRoot)).find((job) => job.conversationId);
  if (!withConversation) {
    throw new Error("No prior agy conversation found for this repository. Run a task or review first, or pass --conversation <id>.");
  }
  return withConversation.conversationId;
}

export function resolveCancelableJob(cwd, reference) {
  const workspaceRoot = resolveWorkspaceRoot(cwd);
  const activeJobs = sortJobsNewestFirst(listJobs(workspaceRoot)).filter((job) => job.status === "running");

  if (reference) {
    const selected = matchJobReference(activeJobs, reference);
    if (!selected) {
      throw new Error(`No active job found for "${reference}".`);
    }
    return { workspaceRoot, job: selected };
  }
  if (activeJobs.length === 1) {
    return { workspaceRoot, job: activeJobs[0] };
  }
  if (activeJobs.length > 1) {
    throw new Error("Multiple agy jobs are active. Pass a job id to /agy-cli:cancel.");
  }
  throw new Error("No active agy jobs to cancel.");
}
