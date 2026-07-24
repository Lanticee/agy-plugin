import { listJobs } from "./state.mjs";
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

  const running = jobs.filter((job) => job.status === "running");
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
