import { Database } from "bun:sqlite";

import { isLaunchTool } from "../../launch/build.ts";
import { aoeTitle } from "../../launch/service.ts";
import { getLaunchIntent } from "../../launch/store.ts";
import { HttpError } from "../../http.ts";
import type { DaemonProvenance } from "../../provenance.ts";
import { requireLaunchPath } from "../validation.ts";
import { getPeer } from "./peers.ts";

export interface GroupRow {
  group_id: number;
  name: string;
  durable: number;
  media_dir: string;
  creator_peer_id: string | null;
  description: string | null;
  created_at: string;
}

export interface GroupPathRow {
  path_id: number;
  group_id: number;
  path: string;
  label: string | null;
  active: number;
  created_at: string;
}

export interface MemberRow {
  group_id: number;
  peer_id: string;
  alias: string;
  join_event_id: number | null;
  history_from_event_id: number | null;
  active: number;
  member_state: string;
  purpose: string | null;
  joined_at: string;
  left_at: string | null;
  session_name: string;
  tool: string;
  activity_state: string | null;
  host_session_id: string | null;
}

export type FormattedGroup = Omit<GroupRow, "durable"> & { durable: boolean };
export type FormattedGroupPath = Omit<GroupPathRow, "active"> & { active: boolean };
export type FormattedMember = Omit<MemberRow, "active"> & { active: boolean };

export function getGroup(db: Database, name: string): GroupRow {
  const group = db.query<GroupRow, [string]>("SELECT * FROM groups WHERE name = ?").get(name);
  if (!group) throw new HttpError(404, "group_not_found", `Group not found: ${name}`);
  return group;
}

export function getGroupById(db: Database, groupId: number): GroupRow {
  const group = db.query<GroupRow, [number]>("SELECT * FROM groups WHERE group_id = ?").get(groupId);
  if (!group) throw new HttpError(404, "group_not_found", `Group not found: ${groupId}`);
  return group;
}

export function formatGroup(group: GroupRow): FormattedGroup {
  return { ...group, durable: Boolean(group.durable) };
}

export function formatGroupPath(path: GroupPathRow): FormattedGroupPath {
  return { ...path, active: Boolean(path.active) };
}

export function insertGroupPath(db: Database, groupId: number, path: string, label: string | null = null): void {
  const launchPath = requireLaunchPath(path);
  db
    .query(
      `INSERT INTO group_paths (group_id, path, label)
       VALUES (?, ?, ?)
       ON CONFLICT(group_id, path) DO UPDATE SET
         active = 1,
         label = COALESCE(excluded.label, label)`,
    )
    .run(groupId, launchPath, label);
}

export function getGroupPaths(db: Database, groupId: number): FormattedGroupPath[] {
  return db
    .query<GroupPathRow, [number]>(
      "SELECT * FROM group_paths WHERE group_id = ? AND active = 1 ORDER BY path ASC",
    )
    .all(groupId)
    .map(formatGroupPath);
}

export function defaultGroupPath(ctx: { provenance?: Pick<DaemonProvenance, "source_root"> | null }): string {
  return requireLaunchPath(ctx.provenance?.source_root ?? process.cwd());
}

export const MEMBER_SELECT_SQL = `gm.*, p.session_name, p.tool, p.activity_state,
  (SELECT s.host_session_id FROM agent_sessions s
   WHERE s.peer_id = gm.peer_id
   ORDER BY s.updated_at DESC, s.created_at DESC LIMIT 1) AS host_session_id`;

export function getGroupMembers(db: Database, groupId: number): FormattedMember[] {
  return db
    .query<MemberRow & { host_session_id: string | null }, [number]>(
      `SELECT ${MEMBER_SELECT_SQL}
       FROM group_members gm
       JOIN peers p ON p.peer_id = gm.peer_id
       WHERE gm.group_id = ?
       ORDER BY gm.active DESC, gm.alias ASC`,
    )
    .all(groupId)
    .map((member) => ({ ...member, active: Boolean(member.active) }));
}

export function deriveBackendTitleForPeer(db: Database, peerId: string): string {
  const peer = getPeer(db, peerId);
  if (!isLaunchTool(peer.tool)) {
    throw new HttpError(400, "invalid_stop", `Cannot derive backend title for non-launch tool: ${peer.tool}`);
  }
  const launch = db
    .query<{ launch_id: string | null }, [string]>(
      `SELECT launch_id
       FROM agent_sessions
       WHERE peer_id = ? AND launch_id IS NOT NULL
       ORDER BY updated_at DESC, created_at DESC
       LIMIT 1`,
    )
    .get(peerId);
  if (!launch?.launch_id) {
    throw new HttpError(400, "invalid_stop", "peer_id stop requires an agent session with launch_id; pass title instead");
  }
  const durable = getLaunchIntent(db, launch.launch_id);
  if (durable?.backend_title) return durable.backend_title;
  const group = db
    .query<{ name: string | null }, [string]>(
      `SELECT g.name
       FROM group_members gm
       JOIN groups g ON g.group_id = gm.group_id
       WHERE gm.peer_id = ? AND gm.active = 1
       ORDER BY gm.joined_at DESC
       LIMIT 1`,
    )
    .get(peerId)?.name ?? undefined;
  return aoeTitle({
    launchId: launch.launch_id,
    peerId,
    ...(group ? { group } : {}),
    sessionName: peer.session_name,
    tool: peer.tool,
  });
}

export function getGroupMember(db: Database, groupId: number, peerId: string): FormattedMember {
  const member = db
    .query<MemberRow & { host_session_id: string | null }, [number, string]>(
      `SELECT ${MEMBER_SELECT_SQL}
       FROM group_members gm
       JOIN peers p ON p.peer_id = gm.peer_id
       WHERE gm.group_id = ? AND gm.peer_id = ?`,
    )
    .get(groupId, peerId);
  if (!member) throw new HttpError(404, "member_not_found", `Peer is not a group member: ${peerId}`);
  return { ...member, active: Boolean(member.active) } as FormattedMember;
}

export function ensureActiveMember(db: Database, groupId: number, peerId: string): MemberRow {
  const member = db
    .query<MemberRow, [number, string]>(
      `SELECT ${MEMBER_SELECT_SQL}
       FROM group_members gm
       JOIN peers p ON p.peer_id = gm.peer_id
       WHERE gm.group_id = ? AND gm.peer_id = ? AND gm.active = 1`,
    )
    .get(groupId, peerId);
  if (!member) throw new HttpError(403, "not_group_member", `Peer is not an active group member: ${peerId}`);
  return member;
}
