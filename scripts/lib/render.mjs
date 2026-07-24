import { formatElapsed } from "./jobs.mjs";

function jobLine(job) {
  const elapsed =
    job.status === "running"
      ? formatElapsed(job.startedAt ?? job.createdAt)
      : formatElapsed(job.startedAt ?? job.createdAt, job.completedAt ?? job.updatedAt);
  const parts = [
    `| ${job.id} | ${job.kind ?? "job"} | ${job.status} | ${elapsed ?? "-"} | ${job.targetLabel ?? "-"} | ${job.summary ?? "-"} |`
  ];
  return parts.join("");
}

export function renderStatusReport(snapshot) {
  const lines = [];
  lines.push("| Job | Kind | Status | Elapsed | Target | Summary |");
  lines.push("|---|---|---|---|---|---|");
  for (const job of snapshot.running) {
    lines.push(jobLine(job));
  }
  for (const job of snapshot.recent) {
    lines.push(jobLine(job));
  }
  if (snapshot.running.length === 0 && snapshot.recent.length === 0) {
    return "No agy jobs recorded for this repository yet.";
  }
  lines.push("");
  lines.push("Use `/agy-cli:result [job-id]` for finished output, `/agy-cli:cancel [job-id]` to stop a running job.");
  return lines.join("\n");
}

export function renderJobHeader(job) {
  const label = job.kind === "adversarial-review" ? "Gemini adversarial review via agy" : "Gemini review via agy";
  const focus = job.focus ? `, focus: ${job.focus}` : "";
  return `${label} (${job.model ?? "default model"}), target: ${job.targetLabel ?? "unknown"}${focus} [job ${job.id}]`;
}

export function renderJobResult(job, payload) {
  const lines = [renderJobHeader(job), ""];
  if (job.status === "failed") {
    lines.push(`Job failed (exit ${payload?.exitStatus ?? "unknown"}).`);
    if (payload?.stderr?.trim()) {
      lines.push("", "stderr:", "```", payload.stderr.trim(), "```");
    }
  }
  if (job.status === "cancelled") {
    lines.push("Job was cancelled before completion.");
  }
  if (payload?.output?.trim()) {
    lines.push(payload.output.trimEnd());
  }
  return lines.join("\n");
}

export function renderCancelReport(job) {
  return `Cancelled job ${job.id} (${job.kind ?? "job"}, was running since ${job.startedAt ?? job.createdAt}).`;
}
