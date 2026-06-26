import { createHash } from "node:crypto";
import { stat } from "node:fs/promises";

import { transitionArchive } from "../../lifecycle/archive.ts";
import { type LaunchTool } from "../../launch/build.ts";
import { type LaunchRequest, resolveLaunchSpec } from "../../launch/service.ts";
import { resolveConfiguredAgentLaunchProfileFromPath } from "../../launch/profiles.ts";
import { LocalLivenessProbe, type Liveness } from "../../lifecycle/probe.ts";
import { HttpError } from "../../http.ts";
import { planArchive, markPeerArchived, isPeerArchived, listArchivedSessions, planResume, type ArchivePlan, type ResumePlan, type ArchiveAliasReservation, type ArchivedSessionSummary } from "../repo/archive.ts";
import type { DaemonContext } from "../server.ts";
import { debug, log } from "../server.ts";
import { emitWebStateChanged } from "./web-events.ts";

export type { ArchivePlan, ResumePlan, ArchiveAliasReservation, ArchivedSessionSummary };

export function ensureSenderNotArchived(db: DaemonContext["db"], peerId: string): void {
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

function isLocalWebPeer(member: { peer_id: string; tool: string }): boolean {
  return member.tool === "web" || member.peer_id.startsWith("web:");
}

// Archive a whole group as a unit. Each active member is archived via the same
// single-session path (so AOE members are reaped, non-AOE members probed), and
// EVERY member's outcome is reported — a partial result is never collapsed into
// one success/fail bit (Flow I). A failure on one member is captured as a
// 'skipped' row rather than aborting the batch. The daemon-owned local web
// viewer can be a "you" member for UI navigation, but it is not an agent
// session and should never be archived as part of group recovery operations.
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
    if (isLocalWebPeer(member)) {
      results.push({
        alias: member.alias,
        tool: member.tool,
        peer_id: member.peer_id,
        action: "skipped",
        reaped: false,
        zombie: false,
        warning: "local web viewer is not archived by group archive",
      });
      continue;
    }
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
  mode: "launch" | "foreground" | "print";
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

export interface ResumeSessionPreview {
  mode: "launch" | "foreground" | "print";
  peer_id: string;
  session_name: string;
  alias: string | null;
  tool: string;
  group: string | null;
  cwd: string | null;
  host_session_id: string | null;
  action: "will_launch" | "will_print" | "blocked" | "skipped";
  code?: "peer_still_live" | "cwd_missing" | "resume_not_launchable" | "peer_not_archived" | "error";
  force_available: boolean;
  warning?: string;
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
    `  resume in this terminal:   synchronize resume launch --peer-id ${plan.peerId} --force`,
    `  or spawn in AOE:           synchronize resume spawn --peer-id ${plan.peerId} --force`,
    `  or reboot — the lease lapses and resume unblocks.`,
  ].join("\n");
}

function previewFromPlan(
  plan: ResumePlan,
  mode: "launch" | "foreground" | "print",
  action: ResumeSessionPreview["action"],
  extra: Pick<ResumeSessionPreview, "code" | "force_available" | "warning">,
): ResumeSessionPreview {
  return {
    mode,
    peer_id: plan.peerId,
    session_name: plan.sessionName,
    alias: plan.alias,
    tool: plan.tool,
    group: plan.group,
    cwd: plan.cwd,
    host_session_id: plan.hostSessionId,
    action,
    ...extra,
  };
}

function skippedResumePreview(
  ctx: DaemonContext,
  peerId: string,
  mode: "launch" | "foreground" | "print",
  code: ResumeSessionPreview["code"],
  warning: string,
): ResumeSessionPreview {
  const peer = ctx.db
    .query<{ session_name: string; tool: string }, [string]>(
      "SELECT session_name, tool FROM peers WHERE peer_id = ? AND deleted_at IS NULL",
    )
    .get(peerId);
  return {
    mode,
    peer_id: peerId,
    session_name: peer?.session_name ?? peerId,
    alias: null,
    tool: peer?.tool ?? "unknown",
    group: null,
    cwd: null,
    host_session_id: null,
    action: "skipped",
    ...(code ? { code } : {}),
    force_available: false,
    warning,
  };
}

export async function resumeSessionPreview(
  ctx: DaemonContext,
  peerId: string,
  opts: { mode: "launch" | "foreground" | "print"; force?: boolean },
): Promise<ResumeSessionPreview> {
  let plan: ResumePlan;
  try {
    plan = planResume(ctx.db, peerId);
  } catch (error) {
    if (error instanceof HttpError) {
      const code =
        error.code === "peer_not_archived" || error.code === "resume_not_launchable"
          ? error.code
          : "error";
      return skippedResumePreview(ctx, peerId, opts.mode, code, error.message);
    }
    return skippedResumePreview(ctx, peerId, opts.mode, "error", error instanceof Error ? error.message : String(error));
  }

  if (!plan.cwd) {
    return previewFromPlan(plan, opts.mode, "blocked", {
      code: "cwd_missing",
      force_available: false,
      warning: `Peer ${peerId} has no recorded cwd; cannot resume.`,
    });
  }
  try {
    await stat(plan.cwd);
  } catch {
    return previewFromPlan(plan, opts.mode, "blocked", {
      code: "cwd_missing",
      force_available: false,
      warning: `cwd ${plan.cwd} is gone. Restore the worktree${plan.gitBranch ? ` for branch '${plan.gitBranch}'` : ""} at that path, then re-run resume.`,
    });
  }

  const liveness = await probeResumeLiveness(ctx, plan);
  if (liveness === "alive" && !opts.force) {
    return previewFromPlan(plan, opts.mode, "blocked", {
      code: "peer_still_live",
      force_available: true,
      warning: peerStillLiveMessage(plan),
    });
  }

  const forcedWarning =
    liveness === "alive" && opts.force
      ? "Force resume will terminate the currently live process before launching."
      : undefined;
  return previewFromPlan(plan, opts.mode, opts.mode === "print" ? "will_print" : "will_launch", {
    force_available: liveness === "alive",
    ...(forcedWarning ? { warning: forcedWarning } : {}),
  });
}

// Orchestrates a single-session resume: validate (archived/cwd/liveness) →
// optionally --force kill a live peer → build the faithful-resume launch and
// either enqueue it via AOE (mode=launch), emit the exact command for inspection
// (mode=print), or return the exact command/env for the CLI to execute in the
// foreground (mode=foreground). The actual reattach happens on
// re-registration (Flow G), which resurrects the archived identity.
export async function resumeSessionApply(
  ctx: DaemonContext,
  peerId: string,
  opts: { mode: "launch" | "foreground" | "print"; force?: boolean },
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
    ...(plan.profileName ? { profileName: plan.profileName } : {}),
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

  if (opts.mode === "print" || opts.mode === "foreground") {
    // Build the exact command + env + cwd for the plain-terminal path without
    // spawning. The user runs it; the hook re-registers by host_session_id
    // correlation and resurrects the identity (Flow F).
    const profile = plan.profileName
      ? resolveConfiguredAgentLaunchProfileFromPath(ctx.paths.configPath, plan.profileName)
      : null;
    const spec = resolveLaunchSpec(
      req,
      { launchId: createHash("sha1").update(`${peerId}:${plan.hostSessionId}`).digest("hex").slice(0, 32), peerId: plan.peerId, home: ctx.paths.home },
      { profile },
    );
    result.command = spec.command;
    result.env = opts.mode === "print" ? redactProfileEnv(spec.env, profile?.env ?? {}) : spec.env;
    log(`resume ${opts.mode} peer=${peerId} cwd=${plan.cwd}${forced ? " (forced)" : ""}`);
    debug(`resume: ${opts.mode} command peer=${peerId} ${spec.command.join(" ")}`);
    return result;
  }

  // AOE path: enqueue the spawn through the launch machinery (Flow E).
  result.launch = await ctx.launchService.launch(req);
  log(`resume spawn peer=${peerId} cwd=${plan.cwd}${forced ? " (forced)" : ""} (AOE spawn enqueued)`);
  debug(`resume: AOE spawn enqueued peer=${peerId} host_session=${plan.hostSessionId}`);
  return result;
}

function redactProfileEnv(env: Record<string, string>, profileEnv: Record<string, string>): Record<string, string> {
  if (Object.keys(profileEnv).length === 0) return env;
  const redacted = { ...env };
  for (const key of Object.keys(profileEnv)) {
    if (key in redacted) redacted[key] = "<redacted:agent-profile>";
  }
  return redacted;
}

export interface GroupResumeMemberResult {
  alias: string | null;
  tool: string;
  peer_id: string;
  action: "launching" | "printed" | "skipped" | "blocked";
  warning?: string;
}

export interface GroupResumePreviewMember extends ResumeSessionPreview {
  alias: string | null;
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

export async function resumeGroupPreview(
  ctx: DaemonContext,
  groupId: number,
  opts: { mode: "launch" | "print"; force?: boolean; only?: string[]; exclude?: string[] },
): Promise<GroupResumePreviewMember[]> {
  const members = ctx.db
    .query<{ peer_id: string; alias: string; tool: string }, [number]>(
      `SELECT gm.peer_id AS peer_id, gm.alias AS alias, p.tool AS tool
       FROM group_members gm JOIN peers p ON p.peer_id = gm.peer_id
       WHERE gm.group_id = ? AND gm.member_state = 'archived' ORDER BY gm.alias ASC`,
    )
    .all(groupId);

  const results: GroupResumePreviewMember[] = [];
  for (const member of members) {
    if (opts.only && opts.only.length > 0 && !opts.only.includes(member.alias)) continue;
    if (opts.exclude && opts.exclude.includes(member.alias)) continue;
    const preview = await resumeSessionPreview(ctx, member.peer_id, {
      mode: opts.mode,
      ...(opts.force ? { force: true } : {}),
    });
    results.push({ ...preview, alias: preview.alias ?? member.alias, tool: preview.tool || member.tool });
  }
  return results;
}
