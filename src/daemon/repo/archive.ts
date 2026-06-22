import type { Database } from "bun:sqlite";

import { isLaunchTool, type LaunchTool } from "../../launch/build.ts";
import { getLaunchIntentByPeer } from "../../launch/store.ts";
import { HttpError } from "../../http.ts";

export interface ArchiveAliasReservation {
  group: string;
  alias: string;
}

export interface ArchivePlan {
  peerId: string;
  sessionName: string;
  tool: string;
  /** Launch/AOE-owned: we can reap the backend runtime on archive. */
  isAoe: boolean;
  backendTitle: string | null;
  /** Captured pid for the non-AOE liveness probe (zombie detection). */
  pid: number | null;
  /** Seats this archive will reserve, one per active membership. */
  aliases: ArchiveAliasReservation[];
  alreadyArchived: boolean;
}

// db-only: compute everything the archive needs without performing it. Exported
// so the AOE/non-AOE classification + alias enumeration is unit-testable and so
// --dry-run can report the plan without mutating.
export function planArchive(db: Database, peerId: string): ArchivePlan | null {
  const peer = db
    .query<{ session_name: string; tool: string; lifecycle_state: string }, [string]>(
      "SELECT session_name, tool, lifecycle_state FROM peers WHERE peer_id = ? AND deleted_at IS NULL",
    )
    .get(peerId);
  if (!peer) return null;

  const launch = getLaunchIntentByPeer(db, peerId);
  const backendTitle = launch?.backend_title ?? null;
  const isAoe = Boolean(backendTitle);

  const pid = db
    .query<{ pid: number | null }, [string]>(
      "SELECT pid FROM agent_sessions WHERE peer_id = ? ORDER BY updated_at DESC, created_at DESC LIMIT 1",
    )
    .get(peerId)?.pid ?? null;

  const aliases = db
    .query<{ group: string; alias: string }, [string]>(
      `SELECT g.name AS "group", gm.alias AS alias
       FROM group_members gm
       JOIN groups g ON g.group_id = gm.group_id
       WHERE gm.peer_id = ? AND gm.active = 1
       ORDER BY g.name ASC`,
    )
    .all(peerId);

  return {
    peerId,
    sessionName: peer.session_name,
    tool: peer.tool,
    isAoe,
    backendTitle,
    pid,
    aliases,
    alreadyArchived: peer.lifecycle_state === "archived",
  };
}

// db-only mutation: flip the peer to archived and convert every active
// membership into a reserved archived seat. Keeps the active⇔member_state
// invariant (active=0 ⇔ member_state='archived' here) and leaves left_at NULL
// (an archived member did NOT leave). Returns the reserved seats.
export function markPeerArchived(
  db: Database,
  peerId: string,
  opts: { reason?: string | null; source: "manual" | "auto"; now?: string },
): ArchiveAliasReservation[] {
  const now = opts.now ?? new Date().toISOString();
  const reserved = db
    .query<{ group: string; alias: string }, [string]>(
      `SELECT g.name AS "group", gm.alias AS alias
       FROM group_members gm
       JOIN groups g ON g.group_id = gm.group_id
       WHERE gm.peer_id = ? AND gm.active = 1
       ORDER BY g.name ASC`,
    )
    .all(peerId);
  db.transaction(() => {
    db.query(
      `UPDATE peers
       SET lifecycle_state = 'archived', archived_at = ?, archived_reason = ?, archive_source = ?, updated_at = ?
       WHERE peer_id = ? AND deleted_at IS NULL`,
    ).run(now, opts.reason ?? null, opts.source, now, peerId);
    db.query(
      "UPDATE group_members SET active = 0, member_state = 'archived' WHERE peer_id = ? AND active = 1",
    ).run(peerId);
  })();
  return reserved;
}

export function isPeerArchived(db: Database, peerId: string): boolean {
  return (
    db
      .query<{ lifecycle_state: string }, [string]>(
        "SELECT lifecycle_state FROM peers WHERE peer_id = ? AND deleted_at IS NULL",
      )
      .get(peerId)?.lifecycle_state === "archived"
  );
}

export interface ArchivedSessionSummary {
  peer_id: string;
  session_name: string;
  tool: string;
  archived_at: string | null;
  archived_reason: string | null;
  archive_source: string | null;
  aliases: ArchiveAliasReservation[];
}

// List every archived (resumable) identity with its reserved seats. Powers
// `bridge_list_archived` / a future `resume --list`. Archived counts are small,
// so the per-peer seat lookup is fine.
export function listArchivedSessions(db: Database): ArchivedSessionSummary[] {
  const peers = db
    .query<
      { peer_id: string; session_name: string; tool: string; archived_at: string | null; archived_reason: string | null; archive_source: string | null },
      []
    >(
      `SELECT peer_id, session_name, tool, archived_at, archived_reason, archive_source
       FROM peers WHERE lifecycle_state = 'archived' AND deleted_at IS NULL
       ORDER BY archived_at DESC, session_name ASC`,
    )
    .all();
  return peers.map((peer) => ({
    ...peer,
    aliases: db
      .query<{ group: string; alias: string }, [string]>(
        `SELECT g.name AS "group", gm.alias AS alias
         FROM group_members gm JOIN groups g ON g.group_id = gm.group_id
         WHERE gm.peer_id = ? AND gm.member_state = 'archived' ORDER BY g.name ASC`,
      )
      .all(peer.peer_id),
  }));
}

export interface ResumePlan {
  peerId: string;
  tool: LaunchTool;
  profileName: string | null;
  sessionName: string;
  hostSessionId: string;
  hostSessionFile: string | null;
  cwd: string | null;
  gitBranch: string | null;
  pid: number | null;
  group: string | null;
  alias: string | null;
  isAoe: boolean;
  backendTitle: string | null;
  model: string | null;
  args: string[] | null;
}

// db-only: validate the identity is resumable and gather everything needed to
// rebuild its launch. Throws the typed failure codes for the gates that depend
// only on stored state (cwd existence + liveness are real-time, checked by the
// orchestration). Exported for unit testing.
export function planResume(db: Database, peerId: string): ResumePlan {
  const peer = db
    .query<{ session_name: string; tool: string; lifecycle_state: string }, [string]>(
      "SELECT session_name, tool, lifecycle_state FROM peers WHERE peer_id = ? AND deleted_at IS NULL",
    )
    .get(peerId);
  if (!peer) throw new HttpError(404, "peer_not_found", `Peer not found: ${peerId}`);
  if (peer.lifecycle_state !== "archived") {
    throw new HttpError(409, "peer_not_archived", `Peer ${peerId} is not archived (state=${peer.lifecycle_state}); only archived identities are resumable.`);
  }
  if (!isLaunchTool(peer.tool)) {
    throw new HttpError(409, "resume_not_launchable", `Peer ${peerId} tool '${peer.tool}' is not launchable; resume is inspect-only.`);
  }

  const session = db
    .query<{ host_session_id: string; host_session_file: string | null; cwd: string | null; git_branch: string | null; pid: number | null }, [string]>(
      `SELECT host_session_id, host_session_file, cwd, git_branch, pid
       FROM agent_sessions WHERE peer_id = ? ORDER BY updated_at DESC, created_at DESC LIMIT 1`,
    )
    .get(peerId);
  if (!session?.host_session_id) {
    throw new HttpError(409, "resume_not_launchable", `Peer ${peerId} has no captured host session to resume.`);
  }

  const launch = getLaunchIntentByPeer(db, peerId);
  const membership = db
    .query<{ group: string; alias: string }, [string]>(
      `SELECT g.name AS "group", gm.alias AS alias
       FROM group_members gm JOIN groups g ON g.group_id = gm.group_id
       WHERE gm.peer_id = ? AND gm.member_state = 'archived' ORDER BY g.name ASC LIMIT 1`,
    )
    .get(peerId);

  let args: string[] | null = null;
  if (launch?.args_json) {
    try {
      const parsed = JSON.parse(launch.args_json);
      if (Array.isArray(parsed)) args = parsed as string[];
    } catch {
      args = null;
    }
  }

  return {
    peerId,
    tool: peer.tool,
    sessionName: peer.session_name,
    hostSessionId: session.host_session_id,
    hostSessionFile: session.host_session_file,
    cwd: session.cwd,
    gitBranch: session.git_branch,
    pid: session.pid,
    group: membership?.group ?? launch?.target_group ?? null,
    alias: membership?.alias ?? null,
    isAoe: Boolean(launch?.backend_title),
    backendTitle: launch?.backend_title ?? null,
    profileName: launch?.profile_name ?? null,
    model: launch?.model ?? null,
    args,
  };
}
