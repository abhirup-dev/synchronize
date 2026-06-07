import { createHash } from "node:crypto";
import { stat } from "node:fs/promises";

import { transitionArchive } from "../../lifecycle/archive.ts";
import { type LaunchTool } from "../../launch/build.ts";
import { type LaunchRequest, resolveLaunchSpec } from "../../launch/service.ts";
import { LocalLivenessProbe, type Liveness } from "../../lifecycle/probe.ts";
import { HttpError } from "../../http.ts";
import { planArchive, markPeerArchived, isPeerArchived, listArchivedSessions, planResume, type ArchivePlan, type ResumePlan, type ArchiveAliasReservation, type ArchivedSessionSummary } from "../repo/archive.ts";
import type { DaemonContext } from "../server.ts";
import { debug, log } from "../server.ts";
import { emitWebStateChanged } from "./web-events.ts";

export type { ArchivePlan, ResumePlan, ArchiveAliasReservation, ArchivedSessionSummary };

function ensureSenderNotArchived(db: DaemonContext["db"], peerId: string): void {
  const peer = db
    .query<{ lifecycle_state: string }, [string]>(
      "SELECT lifecycle_state FROM peers WHERE peer_id = ? AND deleted_at IS NULL",
    )
    .get(peerId);
  if (peer?.lifecycle_state === "archived") {
    debug(`guard: must_reregister sender=${peerId} (archived)`);
    throw new HttpError(409, "must_reregister", "This identity is archived. Re-register before sending.");
  }
}

export interface ArchiveSessionResult {
  peer_id: string;
  session_name: string;
  tool: string;
  action: "archived" | "already_archived" | "would_archive";
  reaped: boolean;
  zombie: boolean;
  aliases: ArchiveAliasReservation[];
  warning?: string;
  dry_run?: boolean;
  resume_hint?: string;
}

// Orchestrates one session archive: state-machine check → reap (AOE) or probe
// (non-AOE) → persist → notify. Reused by both the single-session and the
// group-archive routes.
export async function archiveSessionApply(
  ctx: DaemonContext,
  peerId: string,
  opts: { reason?: string | null; dryRun?: boolean; source?: "manual" | "auto" },
): Promise<ArchiveSessionResult> {
  const plan = planArchive(ctx.db, peerId);
  if (!plan) throw new HttpError(404, "peer_not_found", `Peer not found: ${peerId}`);

  const base: ArchiveSessionResult = {
    peer_id: plan.peerId,
    session_name: plan.sessionName,
    tool: plan.tool,
    action: "archived",
    reaped: false,
    zombie: false,
    aliases: plan.aliases,
    resume_hint: `synchronize resume launch --peer-id ${plan.peerId}`,
  };

  if (plan.alreadyArchived) {
    return { ...base, action: "already_archived" };
  }

  // Validate the transition through the pure state machine (active → archived).
  const transition = transitionArchive("active", { type: "archive_requested", ...(opts.reason ? { reason: opts.reason } : {}) });
  if (!transition.ok) {
    throw new HttpError(409, "invalid_archive", `Cannot archive peer ${peerId} from its current state`);
  }

  if (opts.dryRun) {
    return { ...base, action: "would_archive", dry_run: true };
  }

  let reaped = false;
  let zombie = false;
  let warning: string | undefined;

  if (plan.isAoe && plan.backendTitle) {
    // Free the runtime. Best-effort: if the backend session is already gone the
    // reap throws — that's fine, the slot is reclaimed either way.
    try {
      await ctx.launchService.stop(plan.backendTitle);
      reaped = true;
      debug(`archive: reaped backend title=${plan.backendTitle} peer=${peerId}`);
    } catch {
      reaped = false;
      warning = "backend session was not reapable (already gone)";
      debug(`archive: reap failed (already gone) title=${plan.backendTitle} peer=${peerId}`);
    }
  } else {
    // Non-AOE: we cannot reap a process we do not own. Probe to classify it.
    const probe = new LocalLivenessProbe();
    const liveness: Liveness = await probe.probe({ pid: plan.pid });
    if (liveness === "alive") {
      zombie = true;
      warning = "process is still alive (zombie); it cannot send until it re-registers, and resume is blocked until it stops";
      debug(`archive: ZOMBIE peer=${peerId} pid=${plan.pid} still alive (archived but unreaped)`);
    } else {
      debug(`archive: non-AOE peer=${peerId} pid=${plan.pid ?? "none"} confirmed dead`);
    }
  }

  const reserved = markPeerArchived(ctx.db, peerId, { reason: opts.reason ?? null, source: opts.source ?? "manual" });
  ctx.subscribers.delete(peerId);
  log(`archive transition active->archived on archive_requested peer=${peerId} seats=${reserved.length} reaped=${reaped} zombie=${zombie}`);
  debug(`archive: reserved seats peer=${peerId} ${reserved.map((r) => `${r.group}/${r.alias}`).join(",") || "(none)"}`);
  emitWebStateChanged(ctx, { domains: ["peers", "groups", "agent_sessions"], peerId });

  return { ...base, reaped, zombie, ...(warning ? { warning } : {}) };
}

export interface GroupArchiveMemberResult {
  alias: string;
  tool: string;
  peer_id: string;
  action: "archived" | "already_archived" | "would_archive" | "skipped";
  reaped: boolean;
  zombie: boolean;
  warning?: string;
}

// Archive a whole group as a unit. Each active member is archived via the same
// single-session path (so AOE members are reaped, non-AOE members probed), and
// EVERY member's outcome is reported — a partial result is never collapsed into
// one success/fail bit (Flow I). A failure on one member is captured as a
// 'skipped' row rather than aborting the batch.
export async function archiveGroupApply(
  ctx: DaemonContext,
  groupId: number,
  opts: { reason?: string | null; dryRun?: boolean },
): Promise<GroupArchiveMemberResult[]> {
  const members = ctx.db
    .query<{ peer_id: string; alias: string; tool: string }, [number]>(
      `SELECT gm.peer_id AS peer_id, gm.alias AS alias, p.tool AS tool
       FROM group_members gm
       JOIN peers p ON p.peer_id = gm.peer_id
       WHERE gm.group_id = ? AND gm.active = 1
       ORDER BY gm.alias ASC`,
    )
    .all(groupId);

  const results: GroupArchiveMemberResult[] = [];
  for (const member of members) {
    try {
      const r = await archiveSessionApply(ctx, member.peer_id, {
        reason: opts.reason ?? null,
        dryRun: opts.dryRun ?? false,
        source: "manual",
      });
      results.push({
        alias: member.alias,
        tool: member.tool,
        peer_id: member.peer_id,
        action: r.action,
        reaped: r.reaped,
        zombie: r.zombie,
        ...(r.warning ? { warning: r.warning } : {}),
      });
    } catch (error) {
      results.push({
        alias: member.alias,
        tool: member.tool,
        peer_id: member.peer_id,
        action: "skipped",
        reaped: false,
        zombie: false,
        warning: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return results;
}

export interface ResumeSessionResult {
  mode: "launch" | "print";
  peer_id: string;
  tool: LaunchTool;
  cwd: string;
  host_session_id: string;
  forced: boolean;
  /** Plain-terminal path: the exact command + env + cwd to run. */
  command?: string[];
  env?: Record<string, string>;
  /** AOE path: the enqueued launch result. */
  launch?: unknown;
}

export async function probeResumeLiveness(ctx: DaemonContext, plan: ResumePlan): Promise<Liveness> {
  if (plan.isAoe && plan.backendTitle) {
    return (await ctx.launchService.hasBackendSession(plan.backendTitle)) ? "alive" : "dead";
  }
  return new LocalLivenessProbe().probe({ pid: plan.pid });
}

export function peerStillLiveMessage(plan: ResumePlan): string {
  return [
    `"${plan.alias ?? plan.sessionName}" (peer ${plan.peerId}) is still alive — resume is blocked.`,
    `  pid ${plan.pid ?? "?"}   tool ${plan.tool}   cwd ${plan.cwd ?? "?"}`,
    `  host_session ${plan.hostSessionId}`,
    plan.pid != null ? `  stop it yourself:   kill ${plan.pid}   (or close its terminal)` : `  stop it yourself (close its terminal)`,
    `  or let synchronize do it:   synchronize resume launch --peer-id ${plan.peerId} --force`,
    `  or reboot — the lease lapses and resume unblocks.`,
  ].join("\n");
}

// Orchestrates a single-session resume: validate (archived/cwd/liveness) →
// optionally --force kill a live peer → build the faithful-resume launch and
// either enqueue it via AOE (mode=launch) or emit the exact command for the user
// to run in their own terminal (mode=print). The actual reattach happens on
// re-registration (Flow G), which resurrects the archived identity.
export async function resumeSessionApply(
  ctx: DaemonContext,
  peerId: string,
  opts: { mode: "launch" | "print"; force?: boolean },
): Promise<ResumeSessionResult> {
  const plan = planResume(ctx.db, peerId);

  // cwd gate (C1): the workspace must exist; resume is meaningless without it.
  if (!plan.cwd) {
    throw new HttpError(409, "cwd_missing", `Peer ${peerId} has no recorded cwd; cannot resume.`);
  }
  try {
    await stat(plan.cwd);
  } catch {
    throw new HttpError(
      409,
      "cwd_missing",
      `cwd ${plan.cwd} is gone. Restore the worktree${plan.gitBranch ? ` for branch '${plan.gitBranch}'` : ""} at that path, then re-run resume. (Transcript is preserved.)`,
    );
  }

  // liveness gate (D8/C3): a provably-live identity blocks resume unless --force.
  const liveness = await probeResumeLiveness(ctx, plan);
  let forced = false;
  if (liveness === "alive") {
    if (!opts.force) {
      debug(`resume: BLOCKED peer_still_live peer=${peerId} pid=${plan.pid ?? "?"} isAoe=${plan.isAoe}`);
      throw new HttpError(409, "peer_still_live", peerStillLiveMessage(plan));
    }
    // --force: re-verify alive on its host, then terminate. "--force terminates
    // the running process."
    if (plan.isAoe && plan.backendTitle) {
      await ctx.launchService.stop(plan.backendTitle).catch(() => {});
    } else if (plan.pid != null) {
      try {
        process.kill(plan.pid, "SIGKILL");
      } catch {
        // already gone between probe and kill — fine, proceed.
      }
    }
    forced = true;
    log(`resume: --force terminated live peer=${peerId} pid=${plan.pid ?? "?"} before resume`);
  }

  const transition = transitionArchive("archived", { type: "resume_requested" });
  if (!transition.ok) throw new HttpError(409, "invalid_resume", `Cannot resume peer ${peerId} from its current state`);

  const req: LaunchRequest = {
    tool: plan.tool,
    name: plan.alias ?? plan.sessionName,
    repo: plan.cwd,
    peerId: plan.peerId,
    resume: { hostSessionId: plan.hostSessionId, hostSessionFile: plan.hostSessionFile },
    ...(plan.group ? { group: plan.group } : {}),
    ...(plan.model ? { model: plan.model } : {}),
    ...(plan.args ? { args: plan.args } : {}),
  };

  const result: ResumeSessionResult = {
    mode: opts.mode,
    peer_id: plan.peerId,
    tool: plan.tool,
    cwd: plan.cwd,
    host_session_id: plan.hostSessionId,
    forced,
  };

  if (opts.mode === "print") {
    // Build the exact command + env + cwd for the plain-terminal path without
    // spawning. The user runs it; the hook re-registers by host_session_id
    // correlation and resurrects the identity (Flow F).
    const spec = resolveLaunchSpec(req, { launchId: createHash("sha1").update(`${peerId}:${plan.hostSessionId}`).digest("hex").slice(0, 32), peerId: plan.peerId, home: ctx.paths.home });
    result.command = spec.command;
    result.env = spec.env;
    log(`resume print peer=${peerId} cwd=${plan.cwd}${forced ? " (forced)" : ""}`);
    debug(`resume: print command peer=${peerId} ${spec.command.join(" ")}`);
    return result;
  }

  // AOE path: enqueue the spawn through the launch machinery (Flow E).
  result.launch = await ctx.launchService.launch(req);
  log(`resume launch peer=${peerId} cwd=${plan.cwd}${forced ? " (forced)" : ""} (AOE spawn enqueued)`);
  debug(`resume: AOE spawn enqueued peer=${peerId} host_session=${plan.hostSessionId}`);
  return result;
}

export interface GroupResumeMemberResult {
  alias: string | null;
  tool: string;
  peer_id: string;
  action: "launching" | "printed" | "skipped" | "blocked";
  warning?: string;
}

// Resume a whole archived group. Each archived member is resumed via the same
// single-session path; non-launchable (inspect-only) members are skipped and
// live zombies are blocked — every member's outcome is reported (never collapsed).
export async function resumeGroupApply(
  ctx: DaemonContext,
  groupId: number,
  opts: { mode: "launch" | "print"; force?: boolean; only?: string[]; exclude?: string[] },
): Promise<GroupResumeMemberResult[]> {
  const members = ctx.db
    .query<{ peer_id: string; alias: string; tool: string }, [number]>(
      `SELECT gm.peer_id AS peer_id, gm.alias AS alias, p.tool AS tool
       FROM group_members gm JOIN peers p ON p.peer_id = gm.peer_id
       WHERE gm.group_id = ? AND gm.member_state = 'archived' ORDER BY gm.alias ASC`,
    )
    .all(groupId);

  const results: GroupResumeMemberResult[] = [];
  for (const member of members) {
    if (opts.only && opts.only.length > 0 && !opts.only.includes(member.alias)) continue;
    if (opts.exclude && opts.exclude.includes(member.alias)) continue;
    try {
      await resumeSessionApply(ctx, member.peer_id, { mode: opts.mode, ...(opts.force ? { force: true } : {}) });
      results.push({ alias: member.alias, tool: member.tool, peer_id: member.peer_id, action: opts.mode === "print" ? "printed" : "launching" });
    } catch (error) {
      const code = error instanceof HttpError ? error.code : "error";
      const action: GroupResumeMemberResult["action"] =
        code === "peer_still_live" ? "blocked" : "skipped";
      results.push({
        alias: member.alias,
        tool: member.tool,
        peer_id: member.peer_id,
        action,
        warning: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return results;
}
