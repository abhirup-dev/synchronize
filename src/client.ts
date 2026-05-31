import { mkdir, readFile } from "node:fs/promises";
import { closeSync, openSync } from "node:fs";
import { spawn, type ChildProcess } from "node:child_process";
import { resolve } from "node:path";
import { loadDaemonEnvFiles } from "./env-files.ts";
import {
  API_VERSION,
  ENV_STARTED_BY_CLIENT,
  ENV_TOKEN,
  HEALTH_TIMEOUT_MS,
  STALE_LOCK_MS,
  STARTUP_TIMEOUT_MS,
} from "./constants.ts";
import { ensureDir, pathAgeMs, readJson, removePath } from "./fs.ts";
import { getRuntimePaths, type RuntimePaths } from "./paths.ts";
import { collectDaemonProvenance } from "./provenance.ts";

export interface Discovery {
  pid: number;
  host: string;
  port: number;
  baseUrl: string;
  tokenRequired: boolean;
  dbPath: string;
  mediaPath: string;
  startedAt: string;
  provenance?: {
    api_version: number;
    entrypoint_path: string;
    source_root: string;
    git_sha: string | null;
    git_dirty: boolean | null;
  };
}

export interface ClientConfig {
  baseUrl: string;
  token: string | null;
  paths: RuntimePaths;
  started: boolean;
}

export async function ensureDaemon(): Promise<ClientConfig> {
  const paths = getRuntimePaths();
  await ensureDir(paths.home);
  const token = process.env[ENV_TOKEN] ?? null;

  const existing = await readJson<Discovery>(paths.discoveryPath);
  if (existing && (await isHealthy(existing.baseUrl))) {
    log(`using existing daemon base_url=${existing.baseUrl} pid=${existing.pid}`);
    return { baseUrl: existing.baseUrl, token, paths, started: false };
  }

  let started = false;
  await withLaunchLock(paths, async () => {
    const refreshed = await readJson<Discovery>(paths.discoveryPath);
    if (refreshed && (await isHealthy(refreshed.baseUrl))) {
      log(`daemon became healthy while waiting base_url=${refreshed.baseUrl} pid=${refreshed.pid}`);
      return;
    }
    log(`starting daemon home=${paths.home}`);
    const child = await startDaemon(paths);
    started = true;
    await waitForDaemon(paths, child);
  });

  const discovery = await readJson<Discovery>(paths.discoveryPath);
  if (!discovery) throw new Error("Daemon did not write discovery file");
  log(`${started ? "started" : "using"} daemon base_url=${discovery.baseUrl} pid=${discovery.pid}`);
  return { baseUrl: discovery.baseUrl, token, paths, started };
}

// Carries the daemon's structured error envelope across the client boundary so
// MCP/CLI consumers can branch on `code` instead of substring-matching the
// human message. Bridges client-originated validation errors too — anything
// thrown as ApiError gets a deterministic `code` in the MCP error JSON.
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function requestJson<T>(config: ClientConfig, path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("accept", "application/json");
  if (init.body !== undefined && !headers.has("content-type")) {
    headers.set("content-type", "application/json; charset=utf-8");
  }
  if (config.token) headers.set("authorization", `Bearer ${config.token}`);
  const response = await fetch(`${config.baseUrl}${path}`, { ...init, headers });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const code = body?.error?.code ?? "http_error";
    const message = body?.error?.message ?? `${response.status} ${response.statusText}`;
    throw new ApiError(response.status, code, message);
  }
  return body as T;
}

async function isHealthy(baseUrl: string): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
  try {
    const response = await fetch(`${baseUrl}/health`, { signal: controller.signal });
    if (!response.ok) return false;
    const body = await response.json().catch(() => null);
    return body?.service === "synchronize" && body?.api_version === API_VERSION;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

async function withLaunchLock(paths: RuntimePaths, body: () => Promise<void>): Promise<void> {
  while (true) {
    try {
      await mkdir(paths.lockPath);
      break;
    } catch (error) {
      if (!isFileExists(error)) throw error;
      const age = await pathAgeMs(paths.lockPath);
      if (age !== null && age > STALE_LOCK_MS) {
        await removePath(paths.lockPath);
        continue;
      }
      await Bun.sleep(100);
    }
  }

  try {
    await body();
  } finally {
    await removePath(paths.lockPath);
  }
}

async function startDaemon(paths: RuntimePaths): Promise<ChildProcess> {
  await ensureDir(paths.home);
  const daemonPath = resolve(import.meta.dir, "daemon.ts");
  const provenance = collectDaemonProvenance();
  const fileEnv = await loadDaemonEnvFiles(paths, provenance.source_root, process.env);
  // Capture the spawned daemon's stdout/stderr to a dedicated file so an early
  // crash (e.g. EADDRINUSE on the default port) is diagnosable instead of
  // silently swallowed by stdio:"ignore". This file is intentionally distinct
  // from paths.logPath, whose last line is parsed as JSON by readers.
  const errFd = openSync(paths.errLogPath, "a");
  try {
    const child = spawn(process.execPath, ["run", daemonPath], {
      detached: true,
      stdio: ["ignore", errFd, errFd],
      env: {
        ...process.env,
        ...fileEnv,
        [ENV_STARTED_BY_CLIENT]: "1",
      },
    });
    child.unref();
    return child;
  } finally {
    // The child has inherited its own dup of the descriptor; the parent's copy
    // is no longer needed and would otherwise leak for the process lifetime.
    closeSync(errFd);
  }
}

function log(message: string): void {
  console.error(`[synchronize-client] ${message}`);
}

async function waitForDaemon(paths: RuntimePaths, child: ChildProcess): Promise<void> {
  // Held in an object so the `exit` callback's mutation survives TS control-flow
  // narrowing (a plain `let` would be narrowed to `never` after the null init).
  const childState: { exit: { code: number | null; signal: NodeJS.Signals | null } | null } = { exit: null };
  child.once("exit", (code, signal) => {
    childState.exit = { code, signal };
  });

  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const discovery = await readJson<Discovery>(paths.discoveryPath);
    if (discovery && (await isHealthy(discovery.baseUrl))) return;
    // Fail fast: if the spawned daemon already exited without becoming healthy,
    // polling the rest of the timeout is pointless — surface its output now.
    if (childState.exit) {
      const tail = await readErrLogTail(paths);
      throw new Error(
        `Daemon process exited (code=${childState.exit.code} signal=${childState.exit.signal}) before becoming healthy; see ${paths.errLogPath}${tail ? `\n${tail}` : ""}`,
      );
    }
    await Bun.sleep(100);
  }
  const tail = await readErrLogTail(paths);
  throw new Error(
    `Daemon did not become healthy within ${STARTUP_TIMEOUT_MS}ms; see ${paths.errLogPath}${tail ? `\n${tail}` : ""}`,
  );
}

// Returns the trailing portion of the captured daemon stderr/stdout, or an
// empty string if the file is missing/unreadable. Used to enrich startup-
// failure errors with the daemon's own crash output.
async function readErrLogTail(paths: RuntimePaths, maxChars = 2_000): Promise<string> {
  try {
    const raw = (await readFile(paths.errLogPath, "utf8")).trimEnd();
    return raw.length > maxChars ? raw.slice(-maxChars) : raw;
  } catch {
    return "";
  }
}

function isFileExists(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: unknown }).code === "EEXIST",
  );
}
