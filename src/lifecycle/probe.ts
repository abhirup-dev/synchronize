// Host-scoped liveness probe seam (D8).
//
// Determines, in REAL TIME, whether a session's process is alive — used by:
//   * archive of a non-AOE session (decide reap vs let-die),
//   * resume validation (block if the identity is provably still alive),
//   * --force (re-verify the pid is alive on its machine, then kill it).
//
// This is NOT the stored lease. The lease is a death PROXY (presence); the probe
// is ground truth. A confirmed-dead archived peer resumes instantly; only a
// probe-confirmed-live peer blocks.
//
// HOST-SCOPED BY DESIGN: v0 runs the probe locally (process.kill / backend
// list). The seam is shaped so a per-machine remote probe can slot in later for
// cross-machine support WITHOUT changing any caller — callers depend on the
// `LivenessProbe` interface, never on process.kill directly.

import type { SessionBackend } from "../launch/backend.ts";

export type Liveness = "alive" | "dead";

/** What the probe needs to know about a session to check its liveness. */
export interface ProbeTarget {
  /** Backend session title, present iff this session is AOE/backend-managed. */
  backendTitle?: string | null;
  /** OS pid captured at host-session binding time (non-AOE / fallback path). */
  pid?: number | null;
}

export interface LivenessProbe {
  probe(target: ProbeTarget): Promise<Liveness>;
}

/** Injectable pid checker so tests can simulate a live-quiet agent. */
export type PidChecker = (pid: number) => boolean;

/**
 * Default pid checker: `kill(pid, 0)` probes existence without signalling.
 * Throws ESRCH when no such process; EPERM means it EXISTS but we lack
 * permission (still alive). Any other error → treat as dead (conservative).
 */
export const defaultPidChecker: PidChecker = (pid) => {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "EPERM") return true;
    return false;
  }
};

/**
 * Local, host-scoped liveness probe.
 *   * AOE/backend-managed (backendTitle present) → backend.list() contains it?
 *   * otherwise                                  → pid check (kill -0).
 * Both arms are independently injectable for tests.
 */
export class LocalLivenessProbe implements LivenessProbe {
  private readonly backend: SessionBackend | null;
  private readonly checkPid: PidChecker;

  constructor(opts: { backend?: SessionBackend | null; checkPid?: PidChecker } = {}) {
    this.backend = opts.backend ?? null;
    this.checkPid = opts.checkPid ?? defaultPidChecker;
  }

  async probe(target: ProbeTarget): Promise<Liveness> {
    if (target.backendTitle && this.backend) {
      try {
        const sessions = await this.backend.list();
        return sessions.some((session) => session.title === target.backendTitle) ? "alive" : "dead";
      } catch {
        // Backend unreachable → cannot prove alive. Conservative: report dead so
        // resume is not blocked forever by a flaky backend. The reap/kill arms
        // are best-effort and idempotent.
        return "dead";
      }
    }
    if (target.pid != null) {
      return this.checkPid(target.pid) ? "alive" : "dead";
    }
    return "dead";
  }
}
