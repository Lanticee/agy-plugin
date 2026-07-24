import path from "node:path";
import { spawnSync } from "node:child_process";

// Repository-derived arguments must never pass through a shell.
function git(cwd, args, options = {}) {
  return spawnSync("git", args, { cwd, encoding: "utf8", shell: false, ...options });
}

export function resolveWorkspaceRoot(cwd) {
  const result = git(cwd, ["rev-parse", "--show-toplevel"]);
  if (result.status === 0) {
    return result.stdout.trim();
  }
  return path.resolve(cwd);
}
