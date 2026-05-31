import { appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const stderrEnabled = process.env.SYNCHRONIZE_PI_DEBUG === "1";
const home = process.env.SYNCHRONIZE_HOME ?? join(homedir(), ".synchronize");
const logPath = join(home, "pi-extension.log");

let directoryReady = false;
function ensureDir(): void {
  if (directoryReady) return;
  try {
    mkdirSync(home, { recursive: true });
    directoryReady = true;
  } catch {
    /* ignore — file logging will simply skip */
  }
}

export function log(message: string): void {
  const line = `${new Date().toISOString()} [synchronize-pi] pid=${process.pid} ${message}\n`;
  ensureDir();
  try {
    appendFileSync(logPath, line);
  } catch {
    /* ignore */
  }
  if (stderrEnabled) process.stderr.write(line);
}

export function formatError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export function getLogPath(): string {
  return logPath;
}
