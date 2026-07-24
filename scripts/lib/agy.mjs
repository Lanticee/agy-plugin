import { spawn, spawnSync } from "node:child_process";

export const DEFAULT_MODEL = "Gemini 3.6 Flash (Medium)";
export const DEFAULT_PRINT_TIMEOUT = "10m";
const AGY_CMD_ENV = "AGY_COMPANION_AGY_CMD";

export function parseDurationMs(value) {
  const match = /^(\d+)(ms|s|m|h)$/.exec(String(value).trim());
  if (!match) {
    throw new Error(`Invalid duration "${value}". Use forms like 45s, 10m, 1h.`);
  }
  const amount = Number(match[1]);
  const unit = { ms: 1, s: 1000, m: 60000, h: 3600000 }[match[2]];
  return amount * unit;
}

function resolveAgyCommand() {
  const override = process.env[AGY_CMD_ENV];
  if (override) {
    const parts = JSON.parse(override);
    if (!Array.isArray(parts) || parts.length === 0) {
      throw new Error(`${AGY_CMD_ENV} must be a non-empty JSON array.`);
    }
    return { bin: parts[0], prefix: parts.slice(1) };
  }
  // Plain "agy" works on Windows too: CreateProcess resolves it to agy.exe.
  return { bin: "agy", prefix: [] };
}

export function checkAgyAvailable() {
  const { bin, prefix } = resolveAgyCommand();
  try {
    const result = spawnSync(bin, [...prefix, "--help"], {
      stdio: "ignore",
      windowsHide: true,
      timeout: 15000,
      shell: false
    });
    return result.status === 0;
  } catch {
    return false;
  }
}

export function killProcessTree(pid) {
  if (!pid) {
    return;
  }
  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", String(pid), "/t", "/f"], { stdio: "ignore", windowsHide: true });
    return;
  }
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    // already gone
  }
}

export function extractConversationId(logText) {
  const text = String(logText ?? "");
  const created = /Created conversation ([0-9a-f-]{36})/.exec(text);
  if (created) {
    return created[1];
  }
  const printMode = /conversationID="([0-9a-f-]{36})"/.exec(text);
  return printMode ? printMode[1] : null;
}

export function runAgy({
  prompt,
  addDir,
  addDirs,
  model = DEFAULT_MODEL,
  printTimeout = DEFAULT_PRINT_TIMEOUT,
  killGraceMs = 60000,
  logFile,
  conversationId,
  onSpawn
}) {
  const { bin, prefix } = resolveAgyCommand();
  const dirs = addDirs ?? (addDir ? [addDir] : []);
  const args = [
    ...prefix,
    "--print",
    prompt,
    ...dirs.flatMap((dir) => ["--add-dir", dir]),
    ...(logFile ? ["--log-file", logFile] : []),
    ...(conversationId ? ["--conversation", conversationId] : []),
    "--mode",
    "plan",
    "--model",
    model,
    "--print-timeout",
    printTimeout
  ];

  return new Promise((resolve) => {
    // stdio[0] = "ignore" closes stdin — agy hangs forever on an open non-TTY stdin.
    const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true, shell: false });
    let stdout = "";
    let stderr = "";
    let killed = false;
    let settled = false;

    const guardMs = parseDurationMs(printTimeout) + killGraceMs;
    const guard = setTimeout(() => {
      killed = true;
      killProcessTree(child.pid);
    }, guardMs);

    const settle = (status, error = null) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(guard);
      resolve({ status, stdout, stderr: stderr || (error ? String(error) : stderr), killed, pid: child.pid });
    };

    onSpawn?.(child);
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => settle(null, error));
    child.on("close", (status) => settle(status));
  });
}
