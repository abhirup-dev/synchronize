// Shared test helper: stand up a real daemon subprocess under a throwaway
// SYNCHRONIZE_HOME and wait for it to become healthy. Replaces the ~10
// hand-rolled `startDaemon` copies that had drifted across the integration
// suite (different return shapes, env knobs, timeouts, error strings).
//
// The single helper subsumes every prior call shape so migration is mostly a
// delete-the-local-copy + import:
//   startDaemon()                         -> fresh temp home
//   startDaemon(home)                     -> reuse a caller-owned home (restart tests)
//   startDaemon(home, { FOO: "bar" })     -> reuse home + extra env
//   startDaemon({ leaseMs, retentionMs }) -> sweeper/lease tuning knobs
//   startDaemon({ debug: true })          -> SYNCHRONIZE_DEBUG=1 + stderr inherited
//
// The returned object exposes BOTH `baseUrl` (for fetch-based callers) and
// `client` (for src/api/* callers), plus the resolved `home`.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ClientConfig } from "../../src/client.ts";

export interface StartDaemonOptions {
  /** Reuse a caller-owned home dir (e.g. to stop+restart on the same state). */
  home?: string;
  /** Extra environment variables merged into the daemon process env. */
  env?: Record<string, string>;
  /** SYNCHRONIZE_DEBUG=1 + forward the daemon's decision trail to stderr. */
  debug?: boolean;
  /** Convenience knobs that map to the matching SYNCHRONIZE_* env vars. */
  leaseMs?: number;
  retentionMs?: number;
  sweepIntervalMs?: number;
  /** Health-check budget before giving up (default 8s). */
  timeoutMs?: number;
}

export interface TestDaemon {
  home: string;
  baseUrl: string;
  client: ClientConfig;
  stop: () => Promise<void>;
}

// Every temp home this module creates, so a single afterAll(cleanupDaemonHomes)
// per file can reap them. bun runs files sequentially, so a file's afterAll only
// ever sees homes created by that file; double-removal is harmless (force:true).
const createdHomes = new Set<string>();

function normalizeOptions(
  arg: string | StartDaemonOptions,
  legacyEnv?: Record<string, string>,
): StartDaemonOptions {
  if (typeof arg === "string") return { home: arg, ...(legacyEnv ? { env: legacyEnv } : {}) };
  return arg;
}

export async function startDaemon(
  arg: string | StartDaemonOptions = {},
  legacyEnv?: Record<string, string>,
): Promise<TestDaemon> {
  const opts = normalizeOptions(arg, legacyEnv);
  const home = opts.home ?? (await mkdtemp(join(tmpdir(), "synchronize-test-")));
  createdHomes.add(home);

  const env: Record<string, string> = {
    ...process.env,
    ...(opts.env ?? {}),
    SYNCHRONIZE_HOME: home,
    SYNCHRONIZE_PORT: "0",
    ...(opts.debug ? { SYNCHRONIZE_DEBUG: "1" } : {}),
    ...(opts.leaseMs !== undefined ? { SYNCHRONIZE_LEASE_MS: String(opts.leaseMs) } : {}),
    ...(opts.retentionMs !== undefined ? { SYNCHRONIZE_PEER_RETENTION_MS: String(opts.retentionMs) } : {}),
    ...(opts.sweepIntervalMs !== undefined ? { SYNCHRONIZE_SWEEP_INTERVAL_MS: String(opts.sweepIntervalMs) } : {}),
  };

  const proc = Bun.spawn({
    cmd: [process.execPath, "run", "src/daemon.ts"],
    env,
    stdout: "pipe",
    // On debug runs forward the daemon's decision/transition trail so a failing
    // integration test is diagnosable from the runner log alone; otherwise drop it.
    stderr: opts.debug ? "inherit" : "ignore",
  });

  const discoveryPath = join(home, "daemon.json");
  const deadline = Date.now() + (opts.timeoutMs ?? 8_000);
  while (Date.now() < deadline) {
    try {
      const discovery = (await Bun.file(discoveryPath).json()) as { baseUrl: string };
      const health = await fetch(`${discovery.baseUrl}/health`).catch(() => null);
      if (health?.ok) {
        return {
          home,
          baseUrl: discovery.baseUrl,
          client: { baseUrl: discovery.baseUrl, token: null, paths: {} as ClientConfig["paths"], started: false },
          stop: async () => {
            proc.kill();
            await proc.exited;
          },
        };
      }
    } catch {
      await Bun.sleep(50);
    }
  }
  proc.kill();
  await proc.exited;
  throw new Error("daemon did not start");
}

/** Remove every temp home created by startDaemon in this file. */
export async function cleanupDaemonHomes(): Promise<void> {
  await Promise.all([...createdHomes].map((home) => rm(home, { recursive: true, force: true })));
  createdHomes.clear();
}
