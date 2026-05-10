import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
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

export interface Discovery {
  pid: number;
  host: string;
  port: number;
  baseUrl: string;
  tokenRequired: boolean;
  dbPath: string;
  mediaPath: string;
  startedAt: string;
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

  await withLaunchLock(paths, async () => {
    const refreshed = await readJson<Discovery>(paths.discoveryPath);
    if (refreshed && (await isHealthy(refreshed.baseUrl))) {
      log(`daemon became healthy while waiting base_url=${refreshed.baseUrl} pid=${refreshed.pid}`);
      return;
    }
    log(`starting daemon home=${paths.home}`);
    await startDaemon(paths);
    await waitForDaemon(paths);
  });

  const discovery = await readJson<Discovery>(paths.discoveryPath);
  if (!discovery) throw new Error("Daemon did not write discovery file");
  log(`started daemon base_url=${discovery.baseUrl} pid=${discovery.pid}`);
  return { baseUrl: discovery.baseUrl, token, paths, started: true };
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
    const message = body?.error?.message ?? `${response.status} ${response.statusText}`;
    throw new Error(message);
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

async function startDaemon(paths: RuntimePaths): Promise<void> {
  await ensureDir(paths.home);
  const daemonPath = resolve(import.meta.dir, "daemon.ts");
  Bun.spawn([process.execPath, "run", daemonPath], {
    stdout: "ignore",
    stderr: "ignore",
    env: {
      ...process.env,
      [ENV_STARTED_BY_CLIENT]: "1",
    },
  }).unref();
}

function log(message: string): void {
  console.error(`[synchronize-client] ${message}`);
}

async function waitForDaemon(paths: RuntimePaths): Promise<void> {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const discovery = await readJson<Discovery>(paths.discoveryPath);
    if (discovery && (await isHealthy(discovery.baseUrl))) return;
    await Bun.sleep(100);
  }
  throw new Error(`Daemon did not become healthy within ${STARTUP_TIMEOUT_MS}ms; see ${paths.logPath}`);
}

function isFileExists(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: unknown }).code === "EEXIST",
  );
}
