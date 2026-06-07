import { Database } from "bun:sqlite";
import { hostname } from "node:os";

import { ACTIVITY_STATES, type ActivityState } from "../../constants.ts";
import { HttpError } from "../../http.ts";
import { transitionArchive } from "../../lifecycle/archive.ts";
import { debug, log } from "../server.ts";

const WEB_PEER_LEASE_EXPIRES_AT = "9999-12-31T23:59:59.999Z";
export const LOCAL_WEB_PEER_ID = "web:local-human";
const LOCAL_WEB_SESSION_NAME = "web-ui";
const LOCAL_WEB_PURPOSE = "local human web participant";

export interface PeerRow {
  peer_id: string;
  tool: string;
  session_name: string;
  purpose: string | null;
  machine_id: string;
  lease_expires_at: string;
  activity_state: string | null;
  last_activity_at: string | null;
  last_cursor: number;
  lifecycle_state: string;
  archived_at: string | null;
  archived_reason: string | null;
  archive_source: string | null;
  created_at: string;
  updated_at: string;
}

export type Presence = "offline" | "online" | ActivityState;

export function getPeer(db: Database, peerId: string): PeerRow {
  const peer = db
    .query<PeerRow, [string]>("SELECT * FROM peers WHERE peer_id = ? AND deleted_at IS NULL")
    .get(peerId);
  if (!peer) throw new HttpError(404, "peer_not_found", `Peer not found: ${peerId}`);
  return peer;
}

export function ensurePeer(db: Database, peerId: string): void {
  getPeer(db, peerId);
}

export function ensureLocalWebPeer(ctx: { db: Database }): PeerRow {
  upsertPeer(ctx.db, {
    peerId: LOCAL_WEB_PEER_ID,
    tool: "web",
    sessionName: LOCAL_WEB_SESSION_NAME,
    purpose: LOCAL_WEB_PURPOSE,
    machineId: hostname(),
    leaseExpiresAt: WEB_PEER_LEASE_EXPIRES_AT,
  });
  return getPeer(ctx.db, LOCAL_WEB_PEER_ID);
}

export function leaseExpiresAtForTool(tool: string, leaseMs: number): string {
  return tool === "web" ? WEB_PEER_LEASE_EXPIRES_AT : new Date(Date.now() + leaseMs).toISOString();
}

// Presence derivation — the single rule applied wherever a peer is serialized.
// Offline if the lease has lapsed (the only reliable crash detector); else the
// reported activity_state for instrumented agents; else a generic "online" for
// uninstrumented peers (web/cli/codex). See plan-agent-ttl-presence-v0.md.
export function derivePresence(online: boolean, activityState: string | null): Presence {
  if (!online) return "offline";
  if (activityState && (ACTIVITY_STATES as readonly string[]).includes(activityState)) {
    return activityState as ActivityState;
  }
  return "online";
}

// Agents (pi/claude) start at "initializing" and stay there until their first
// activity push. Uninstrumented tools (web/cli/codex) keep NULL → generic
// online. Applied only on first INSERT; re-register/resurrect preserves any
// existing state (see upsertPeer COALESCE).
function initialActivityState(tool: string): ActivityState | null {
  return tool === "pi" || tool === "claude" ? "initializing" : null;
}

export function softDeletePeerIfPresent(
  ctx: { db: Database; subscribers: Map<string, unknown> },
  peerId: string,
  deletedAt = new Date().toISOString(),
): boolean {
  const exists = ctx.db
    .query<{ count: number }, [string]>(
      "SELECT COUNT(*) AS count FROM peers WHERE peer_id = ? AND deleted_at IS NULL",
    )
    .get(peerId)?.count ?? 0;
  if (exists === 0) return false;
  ctx.db.transaction(() => {
    ctx.db
      .query("UPDATE peers SET deleted_at = ?, lease_expires_at = ?, updated_at = ? WHERE peer_id = ? AND deleted_at IS NULL")
      .run(deletedAt, deletedAt, deletedAt, peerId);
    ctx.db
      .query("UPDATE group_members SET active = 0, member_state = 'left', left_at = COALESCE(left_at, ?) WHERE peer_id = ? AND active = 1")
      .run(deletedAt, peerId);
  })();
  ctx.subscribers.delete(peerId);
  return true;
}

export function deactivateStoppedLaunchPeer(ctx: { db: Database; subscribers: Map<string, unknown> }, peerId: string): boolean {
  // When a stop is part of an archive, the backend reap goes through this path.
  // An archived peer must NOT be soft-deleted: its identity, alias, and
  // transcript are deliberately preserved for resume. The lifecycle_state was
  // already flipped to 'archived' by the archive flow before the reap; here we
  // simply refuse to soft-delete it. (Explicit operator DELETE still releases
  // an archived seat — that path calls softDeletePeerIfPresent directly.)
  const archived = ctx.db
    .query<{ lifecycle_state: string }, [string]>("SELECT lifecycle_state FROM peers WHERE peer_id = ? AND deleted_at IS NULL")
    .get(peerId);
  if (archived?.lifecycle_state === "archived") {
    debug(`stop: refused soft-delete of archived peer=${peerId} (reap is not delete; identity preserved for resume)`);
    return false;
  }
  return softDeletePeerIfPresent(ctx, peerId);
}

// Retention-sweep candidates: live (non-deleted) peers whose lease has lapsed
// past the cutoff. Archived peers are EXEMPT — their lease intentionally lapses
// while the identity is reserved for resume, so they must never be swept.
// Exported as a db-only seam so the gate is unit-testable without a full ctx.
export function selectExpiredPeerIds(db: Database, cutoff: string): string[] {
  return db
    .query<{ peer_id: string }, [string]>(
      "SELECT peer_id FROM peers WHERE deleted_at IS NULL AND lifecycle_state != 'archived' AND lease_expires_at < ?",
    )
    .all(cutoff)
    .map((row) => row.peer_id);
}

// Stopped-launch-sweep candidates: peers whose LATEST launch is itself
// 'stopped', not merely peers that have A stopped launch somewhere in history.
// After a resume a peer owns two launch_intents — the stopped original AND the
// running resume — so gating on the latest launch (max updated_at) protects the
// freshly-resumed agent while still cleaning up a genuinely-stopped peer with no
// newer launch. Archived peers are exempt regardless. Exported as a db-only seam
// so the gate is unit-testable without a full DaemonContext.
export function selectStoppedLaunchPeerIds(db: Database): string[] {
  return db
    .query<{ peer_id: string }, []>(
      `SELECT p.peer_id
       FROM peers p
       WHERE p.deleted_at IS NULL
         AND p.lifecycle_state != 'archived'
         AND (
           SELECT li.state
           FROM launch_intents li
           WHERE li.peer_id = p.peer_id
           ORDER BY li.updated_at DESC, li.created_at DESC
           LIMIT 1
         ) = 'stopped'`,
    )
    .all()
    .map((row) => row.peer_id);
}

export function upsertPeer(
  db: Database,
  input: {
    peerId: string;
    tool: string;
    sessionName: string;
    purpose: string | null;
    machineId: string;
    leaseExpiresAt: string;
  },
): void {
  // ON CONFLICT path also clears deleted_at — re-registering with a known
  // peer_id resurrects a soft-deleted peer. The companion fixup below
  // re-activates any group_members rows the peer still owns so a returning
  // peer rejoins their old groups rather than having to re-issue join calls
  // (which would fail with alias-taken if anyone reclaimed in the interim —
  // resurrection is symmetric with the deletion that preceded it).
  // Capture any prior soft-delete timestamp BEFORE the upsert clears it, so we
  // can tell whether this register is a resurrection (and which group_members
  // rows that death deactivated — see reactivateMembershipsOnResurrect).
  const prior =
    db
      .query<{ deleted_at: string | null; lifecycle_state: string | null }, [string]>(
        "SELECT deleted_at, lifecycle_state FROM peers WHERE peer_id = ?",
      )
      .get(input.peerId) ?? null;
  const priorDeletedAt = prior?.deleted_at ?? null;
  const wasArchived = prior?.lifecycle_state === "archived";

  // activity_state is set only on first INSERT (initializing for agents, NULL
  // for uninstrumented tools). On re-register/resurrect we COALESCE so an
  // existing working/idle state is preserved — a heartbeat-driven re-register
  // or a resume must not reset a live agent back to initializing.
  db.query(
    `INSERT INTO peers (peer_id, tool, session_name, purpose, machine_id, lease_expires_at, activity_state)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(peer_id) DO UPDATE SET
       tool = excluded.tool,
       session_name = excluded.session_name,
       purpose = excluded.purpose,
       machine_id = excluded.machine_id,
       lease_expires_at = excluded.lease_expires_at,
       activity_state = COALESCE(activity_state, excluded.activity_state),
       deleted_at = NULL,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
  ).run(
    input.peerId,
    input.tool,
    input.sessionName,
    input.purpose,
    input.machineId,
    input.leaseExpiresAt,
    initialActivityState(input.tool),
  );

  if (priorDeletedAt) reactivateMembershipsOnResurrect(db, input.peerId, priorDeletedAt);

  // Archive resurrection (D4/D8): a register matching an ARCHIVED identity
  // revives it. Lifecycle changes ONLY on register (never on heartbeat/activity,
  // which is why this lives in upsertPeer and not the lease-touch paths). The
  // pure state machine validates the transition; the lease is already reset by
  // the upsert above (fresh TTL on resume).
  if (wasArchived) {
    const transition = transitionArchive("archived", { type: "registered" });
    if (transition.ok) {
      db.query(
        `UPDATE peers
         SET lifecycle_state = 'active', archived_at = NULL, archived_reason = NULL, archive_source = NULL,
             updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
         WHERE peer_id = ?`,
      ).run(input.peerId);
      reactivateArchivedMemberships(db, input.peerId);
      log(`archive transition archived->active on registered peer=${input.peerId} (resume)`);
    }
  }
}

// Restore the group memberships that a soft-delete (operator evict or retention
// sweep) deactivated, when the peer re-registers. Both delete paths set
// group_members.left_at to the SAME timestamp as peers.deleted_at, so rows with
// left_at == the cleared deleted_at are exactly the ones killed by that death —
// this distinguishes a death-deactivation from an earlier voluntary leave
// (which carries an older left_at and must stay inactive). An alias reclaimed by
// someone else during the gap is skipped so the unique-active-alias invariant
// holds. Without this, a revived peer is online but silent in all its groups
// (sync-3nu). The structural alternative (derive active from lease) is sync-<A>.
function reactivateMembershipsOnResurrect(db: Database, peerId: string, deathTimestamp: string): void {
  db.query(
    `UPDATE group_members
     SET active = 1, member_state = 'active', left_at = NULL
     WHERE peer_id = ? AND active = 0 AND member_state = 'left' AND left_at = ?
       AND NOT EXISTS (
         SELECT 1 FROM group_members other
         WHERE other.group_id = group_members.group_id
           AND other.alias = group_members.alias
           AND other.member_state IN ('active','archived')
           AND other.peer_id != group_members.peer_id
       )`,
  ).run(peerId, deathTimestamp);
}

// Reactivate the seats an archive reserved (member_state='archived') when the
// identity re-registers. The archived alias was held exclusively for this peer,
// so reactivation is safe; the NOT EXISTS guard is belt-and-suspenders against a
// concurrent active/archived holder of the same alias (which the reservation
// index should already prevent).
function reactivateArchivedMemberships(db: Database, peerId: string): void {
  db.query(
    `UPDATE group_members
     SET active = 1, member_state = 'active', left_at = NULL
     WHERE peer_id = ? AND member_state = 'archived'
       AND NOT EXISTS (
         SELECT 1 FROM group_members other
         WHERE other.group_id = group_members.group_id
           AND other.alias = group_members.alias
           AND other.member_state IN ('active','archived')
           AND other.peer_id != group_members.peer_id
       )`,
  ).run(peerId);
}

export function findPeerByHostSession(db: Database, hostTool: string, hostSessionId: string): string | undefined {
  return db
    .query<{ peer_id: string }, [string, string]>(
      "SELECT peer_id FROM agent_sessions WHERE host_tool = ? AND host_session_id = ?",
    )
    .get(hostTool, hostSessionId)?.peer_id;
}

export function findPeerByRequiredHostSession(db: Database, hostTool: string, hostSessionId: string): string {
  const peerId = findPeerByHostSession(db, hostTool, hostSessionId);
  if (!peerId) {
    throw new HttpError(404, "agent_session_not_found", `Agent session not found: ${hostTool}/${hostSessionId}`);
  }
  return peerId;
}
