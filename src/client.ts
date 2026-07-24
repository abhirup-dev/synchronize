import { mkdir, readFile } from "node:fs/promises";
import { closeSync, openSync } from "node:fs";
import { spawn, type ChildProcess } from "node:child_process";
import { resolve } from "node:path";
import { loadDaemonEnvFiles } from "./env-files.ts";
import { loadConfig, resolveConnection } from "./config.ts";
import {
  ENV_STARTED_BY_CLIENT,
  ENV_REMOTE_URL,
  STALE_LOCK_MS,
  STARTUP_TIMEOUT_MS,
} from "./constants.ts";
import {
  DAEMON_ERROR_CODES,
  DaemonProbeError,
  describeProbe,
  hasCompetingOwner,
  isDaemonAbsent,
  probeDaemon,
  type DaemonProbe,
} from "./daemon-probe.ts";

// A single timeout is tight enough to misfire under load, and a false "wedged"
// verdict now blocks autostart instead of merely costing a spawn. Two attempts
// on the discovery path; a remote daemon crosses a network, so it gets three.
const DISCOVERY_PROBE_ATTEMPTS = 2;
const REMOTE_PROBE_ATTEMPTS = 3;
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
  // True iff this client is pointed at a daemon on another machine (via
  // SYNCHRONIZE_REMOTE_URL). It is the single ground-truth signal for "the
  // daemon cannot reach a localhost callback on this client", computed once at
  // resolution so transport selection (callback vs poll) never re-parses env.
  // Absent/false means a same-machine daemon (local discovery or auto-spawned).
  remote?: boolean;
}

export async function ensureDaemon(): Promise<ClientConfig> {
  const paths = getRuntimePaths();
  // Connection comes from env > active profile > local discovery. Profiles let
  // operators name remote targets without re-typing SYNCHRONIZE_REMOTE_URL/TOKEN
  // every invocation; env still wins so tests and one-off overrides are intact.
  const conn = resolveConnection(await loadConfig(paths.configPath));
  const token = conn.token;
  const remoteUrl = normalizeRemoteUrl(conn.remoteUrl ?? undefined);
  if (remoteUrl) {
    await validateRemoteDaemon(remoteUrl, token, conn.healthTimeoutMs ?? undefined);
    log(`using remote daemon base_url=${remoteUrl}`);
    return { baseUrl: remoteUrl, token, paths, started: false, remote: true };
  }

  await ensureDir(paths.home);
  const existing = await probeDiscovered(paths, token);
  if (existing.kind === "healthy") {
    log(`using existing daemon ${describeProbe(existing)}`);
    return { baseUrl: existing.baseUrl, token, paths, started: false, remote: false };
  }
  // Refuse early only on POSITIVE evidence that something else owns the
  // endpoint: it identified as the wrong service, demanded a token, or failed
  // for a reason other than nothing-listening. Starting a second daemon on top
  // of one of those makes the situation worse and harder to read, and recovery
  // is an explicit operator verb, never a side effect of a read.
  //
  // A timeout is NOT such evidence, so it falls through to the lock and gets
  // re-probed there. This is the hottest path in the product — every CLI command
  // and MCP call — and the health deadline is tight enough that a loaded machine
  // can miss it twice while the daemon is perfectly fine. A genuinely wedged
  // endpoint is still caught below, one probe round later.
  if (hasCompetingOwner(existing)) {
    throw new DaemonProbeError(
      DAEMON_ERROR_CODES[existing.kind],
      `${describeProbe(existing)}\nRefusing to start a second daemon on an occupied endpoint. Run 'make daemon-relaunch' to recover.`,
    );
  }

  let started = false;
  await withLaunchLock(paths, async () => {
    const refreshed = await probeDiscovered(paths, token);
    if (refreshed.kind === "healthy") {
      log(`daemon became healthy while waiting ${describeProbe(refreshed)}`);
      return;
    }
    // Serialized and re-probed: anything still not absent is occupying the
    // endpoint for real, including a timeout that survived a second round.
    if (!isDaemonAbsent(refreshed)) {
      throw new DaemonProbeError(
        DAEMON_ERROR_CODES[refreshed.kind],
        `${describeProbe(refreshed)}\nRefusing to start a second daemon on an occupied endpoint. Run 'make daemon-relaunch' to recover.`,
      );
    }
    log(`starting daemon home=${paths.home}`);
    const child = await startDaemon(paths);
    started = true;
    await waitForDaemon(paths, child);
  });

  const discovery = await readJson<Discovery>(paths.discoveryPath);
  if (!discovery) throw new Error("Daemon did not write discovery file");
  log(`${started ? "started" : "using"} daemon base_url=${discovery.baseUrl} pid=${discovery.pid}`);
  return { baseUrl: discovery.baseUrl, token, paths, started, remote: false };
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

function normalizeRemoteUrl(raw: string | undefined): string | null {
  const value = raw?.trim();
  if (!value) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${ENV_REMOTE_URL} must be a valid http(s) URL`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`${ENV_REMOTE_URL} must use http or https`);
  }
  return url.toString().replace(/\/$/, "");
}

async function validateRemoteDaemon(baseUrl: string, token: string | null, timeoutMs?: number): Promise<void> {
  const probe = await probeDaemon(baseUrl, {
    token,
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
    attempts: REMOTE_PROBE_ATTEMPTS,
  });
  if (probe.kind !== "healthy") {
    throw new Error(`${ENV_REMOTE_URL} is not usable: ${describeProbe(probe)}`);
  }

  const headers = new Headers({ accept: "application/json" });
  if (token) headers.set("authorization", `Bearer ${token}`);
  const response = await fetch(`${baseUrl}/status`, { headers }).catch((error: unknown) => {
    throw new Error(`${ENV_REMOTE_URL} health passed but /status failed for ${baseUrl}: ${String(error)}`);
  });
  if (response.ok) return;

  if (response.status === 401) {
    const suffix = token ? "check SYNCHRONIZE_TOKEN" : "set SYNCHRONIZE_TOKEN";
    throw new Error(`${ENV_REMOTE_URL} requires bearer auth; ${suffix}`);
  }
  throw new Error(`${ENV_REMOTE_URL} /status failed: ${response.status} ${response.statusText}`);
}

/** Probes whatever the discovery file points at, or reports it missing. */
async function probeDiscovered(paths: RuntimePaths, token: string | null): Promise<DaemonProbe> {
  const discovery = await readJson<Discovery>(paths.discoveryPath);
  if (!discovery?.baseUrl) return { kind: "discovery_missing" };
  return probeDaemon(discovery.baseUrl, { token, attempts: DISCOVERY_PROBE_ATTEMPTS });
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
    // Poll for healthy only. Every other variant is an expected transient here —
    // the daemon we just spawned has not finished binding yet — so it must not
    // be classified or acted on; the loop deadline and the child-exit check
    // below are what bound the wait.
    const discovery = await readJson<Discovery>(paths.discoveryPath);
    if (discovery && (await probeDaemon(discovery.baseUrl)).kind === "healthy") return;
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
