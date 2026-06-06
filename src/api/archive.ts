import { requestJson, type ClientConfig } from "../client.ts";

export interface ArchiveAliasReservation {
  group: string;
  alias: string;
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

export interface GroupArchiveMemberResult {
  alias: string;
  tool: string;
  peer_id: string;
  action: "archived" | "already_archived" | "would_archive" | "skipped";
  reaped: boolean;
  zombie: boolean;
  warning?: string;
}

export interface ArchiveGroupResult {
  group: string;
  dry_run: boolean;
  members: GroupArchiveMemberResult[];
}

export function archiveSession(
  client: ClientConfig,
  input: { peerId?: string; sessionId?: string; reason?: string; dryRun?: boolean },
): Promise<ArchiveSessionResult> {
  return requestJson<ArchiveSessionResult>(client, "/archive/session", {
    method: "POST",
    body: JSON.stringify({
      ...(input.peerId ? { peer_id: input.peerId } : {}),
      ...(input.sessionId ? { session_id: input.sessionId } : {}),
      ...(input.reason ? { reason: input.reason } : {}),
      ...(input.dryRun ? { dry_run: true } : {}),
    }),
  });
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

export function listArchived(client: ClientConfig): Promise<{ sessions: ArchivedSessionSummary[] }> {
  return requestJson<{ sessions: ArchivedSessionSummary[] }>(client, "/archive/sessions");
}

export function archiveGroup(
  client: ClientConfig,
  input: { group: string; reason?: string; dryRun?: boolean },
): Promise<ArchiveGroupResult> {
  return requestJson<ArchiveGroupResult>(client, "/archive/group", {
    method: "POST",
    body: JSON.stringify({
      group: input.group,
      ...(input.reason ? { reason: input.reason } : {}),
      ...(input.dryRun ? { dry_run: true } : {}),
    }),
  });
}
