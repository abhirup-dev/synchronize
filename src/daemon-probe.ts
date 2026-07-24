// Typed, non-mutating readiness check for a daemon endpoint.
//
// The probe observes and classifies; it never starts, stops, or writes anything.
// Callers own policy, and they need the distinction: a boolean answer collapses
// "nothing is listening" together with "something is listening but wedged", and
// the only safe response to those two differs completely — spawn in the first
// case, refuse in the second.
import { API_VERSION, ENV_HEALTH_TIMEOUT_MS, HEALTH_TIMEOUT_MS } from "./constants.ts";

export interface HealthResponse {
  ok: boolean;
  service: string;
  api_version: number;
  capabilities: string[];
  pid: number;
  started_at: string;
  provenance?: {
    api_version: number;
    entrypoint_path: string;
    source_root: string;
    git_sha: string | null;
    git_dirty: boolean | null;
  };
}

export type DaemonProbe =
  /** A compatible synchronize daemon answered. */
  | { kind: "healthy"; baseUrl: string; health: HealthResponse }
  /** No discovery file, so there is no endpoint to probe. */
  | { kind: "discovery_missing" }
  /**
   * The request failed. `connectionRefused` separates "nothing is listening"
   * (safe to spawn) from every other transport failure (not safe to spawn).
   */
  | { kind: "unreachable"; baseUrl: string; cause: string; connectionRefused: boolean }
  /** Listening but not answering in time — a wedged daemon, not an absent one. */
  | { kind: "timed_out"; baseUrl: string; timeoutMs: number; attempts: number }
  /** Answering, but it is not this daemon or not this API version. */
  | { kind: "incompatible"; baseUrl: string; expected: number; actual: unknown }
  /** Answering, but requires a bearer token this caller did not supply. */
  | { kind: "auth_required"; baseUrl: string };

/** Stable codes for launcher diagnostics. */
export const DAEMON_ERROR_CODES = {
  discovery_missing: "DAEMON_DISCOVERY_MISSING",
  unreachable: "DAEMON_UNREACHABLE",
  timed_out: "DAEMON_TIMEOUT",
  incompatible: "DAEMON_API_MISMATCH",
  auth_required: "DAEMON_AUTH_REQUIRED",
} as const;

export class DaemonProbeError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "DaemonProbeError";
  }
}

export interface ProbeOptions {
  timeoutMs?: number;
  token?: string | null;
  /**
   * Timeout attempts before reporting `timed_out`. The default health timeout is
   * 500ms, tight enough that a loaded machine can miss it while the daemon is
   * fine — and callers treat `timed_out` as a hard refusal, so a false positive
   * is expensive. Only timeouts are retried; every other outcome is conclusive.
   */
  attempts?: number;
}

export async function probeDaemon(baseUrl: string, opts: ProbeOptions = {}): Promise<DaemonProbe> {
  const timeoutMs = opts.timeoutMs ?? healthTimeoutMs();
  const attempts = Math.max(1, opts.attempts ?? 1);
  let last: DaemonProbe = { kind: "timed_out", baseUrl, timeoutMs, attempts };
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    last = await probeOnce(baseUrl, timeoutMs, opts.token ?? null, attempts);
    if (last.kind !== "timed_out") return last;
  }
  return last;
}

async function probeOnce(
  baseUrl: string,
  timeoutMs: number,
  token: string | null,
  attempts: number,
): Promise<DaemonProbe> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    const headers = new Headers({ accept: "application/json" });
    if (token) headers.set("authorization", `Bearer ${token}`);
    response = await fetch(`${baseUrl}/health`, { headers, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) return { kind: "timed_out", baseUrl, timeoutMs, attempts };
    return {
      kind: "unreachable",
      baseUrl,
      cause: describe(error),
      connectionRefused: isConnectionRefused(error),
    };
  } finally {
    clearTimeout(timer);
  }

  if (response.status === 401 || response.status === 403) return { kind: "auth_required", baseUrl };
  if (!response.ok) {
    // Something is listening and answering badly. Not refused, so not absent.
    return {
      kind: "unreachable",
      baseUrl,
      cause: `HTTP ${response.status} ${response.statusText}`.trim(),
      connectionRefused: false,
    };
  }

  const body = (await response.json().catch(() => null)) as HealthResponse | null;
  if (body?.service !== "synchronize") {
    return { kind: "incompatible", baseUrl, expected: API_VERSION, actual: body?.service ?? null };
  }
  if (body.api_version !== API_VERSION) {
    return { kind: "incompatible", baseUrl, expected: API_VERSION, actual: body.api_version };
  }
  return { kind: "healthy", baseUrl, health: body };
}

/** True when the endpoint is usable. */
export function isProbeHealthy(probe: DaemonProbe): probe is Extract<DaemonProbe, { kind: "healthy" }> {
  return probe.kind === "healthy";
}

/**
 * True when nothing is listening, so spawning a daemon is the correct response.
 * Every other failure means something IS there — spawning would put a second
 * daemon on top of it, which is the bug this classification exists to prevent.
 */
export function isDaemonAbsent(probe: DaemonProbe): boolean {
  return probe.kind === "discovery_missing" || (probe.kind === "unreachable" && probe.connectionRefused);
}

/**
 * True when the probe is POSITIVE evidence that something else owns the
 * endpoint: it answered and identified as the wrong thing, demanded a token, or
 * failed for a reason other than nothing-listening.
 *
 * `timed_out` is deliberately excluded. It is absence of evidence, not evidence
 * of an owner — a loaded machine can miss a tight health deadline while the
 * daemon is fine. Callers should re-probe a timeout under serialization rather
 * than treat it as a hard verdict.
 */
export function hasCompetingOwner(probe: DaemonProbe): boolean {
  switch (probe.kind) {
    case "incompatible":
    case "auth_required":
      return true;
    case "unreachable":
      return !probe.connectionRefused;
    default:
      return false;
  }
}

/** Human-readable one-liner, prefixed with the stable code. */
export function describeProbe(probe: DaemonProbe): string {
  switch (probe.kind) {
    case "healthy":
      return `healthy pid=${probe.health.pid} api_version=${probe.health.api_version} ${probe.baseUrl}`;
    case "discovery_missing":
      return `${DAEMON_ERROR_CODES.discovery_missing}: no daemon.json; nothing is registered`;
    case "unreachable":
      return `${DAEMON_ERROR_CODES.unreachable}: ${probe.baseUrl} — ${probe.cause}`;
    case "timed_out":
      return `${DAEMON_ERROR_CODES.timed_out}: ${probe.baseUrl} did not answer /health within ${probe.timeoutMs}ms (${probe.attempts} attempt${probe.attempts === 1 ? "" : "s"})`;
    case "incompatible":
      return `${DAEMON_ERROR_CODES.incompatible}: ${probe.baseUrl} reported ${JSON.stringify(probe.actual)}, expected api_version ${probe.expected}`;
    case "auth_required":
      return `${DAEMON_ERROR_CODES.auth_required}: ${probe.baseUrl} requires a bearer token; set SYNCHRONIZE_TOKEN`;
  }
}

/** Throws unless the probe is healthy. For launchers that must not recover. */
export function requireHealthy(probe: DaemonProbe): Extract<DaemonProbe, { kind: "healthy" }> {
  if (probe.kind === "healthy") return probe;
  throw new DaemonProbeError(DAEMON_ERROR_CODES[probe.kind], describeProbe(probe));
}

export function healthTimeoutMs(): number {
  const raw = process.env[ENV_HEALTH_TIMEOUT_MS];
  if (!raw) return HEALTH_TIMEOUT_MS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return HEALTH_TIMEOUT_MS;
  return Math.trunc(parsed);
}

function describe(error: unknown): string {
  if (error instanceof Error) {
    const code = errorCode(error);
    return code ? `${code}: ${error.message}` : error.message;
  }
  return String(error);
}

function isConnectionRefused(error: unknown): boolean {
  const code = error instanceof Error ? errorCode(error) : undefined;
  if (code === "ECONNREFUSED" || code === "ConnectionRefused") return true;
  // Bun reports a refused connection as a plain message on some platforms, with
  // no code to branch on.
  return error instanceof Error && /unable to connect|connection refused/i.test(error.message);
}

function errorCode(error: Error): string | undefined {
  const direct = (error as { code?: unknown }).code;
  if (typeof direct === "string") return direct;
  const cause = (error as { cause?: unknown }).cause;
  if (cause && typeof cause === "object" && typeof (cause as { code?: unknown }).code === "string") {
    return (cause as { code: string }).code;
  }
  return undefined;
}
