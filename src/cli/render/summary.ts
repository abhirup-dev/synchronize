import type { SummaryResponse } from "../../api/types.ts";
import { formatBytes, formatDuration, formatRelative, table } from "./table.ts";

export function renderSummary(summary: SummaryResponse): string {
  const uptime = formatDuration(Date.now() - new Date(summary.daemon.started_at).getTime());
  const lines: string[] = [];
  lines.push(
    `synchronize top   daemon: ${summary.ok ? "ok" : "down"}   uptime: ${uptime}   pid: ${summary.daemon.pid}   ${summary.daemon.base_url}`,
  );
  lines.push(
    `PEERS ${summary.totals.peers.online} online / ${summary.totals.peers.total} total   GROUPS ${summary.totals.groups.durable} durable / ${summary.totals.groups.ephemeral} ephemeral   EVENTS ${summary.totals.events.total}   INBOX ${summary.totals.inbox.pending} pending   MEDIA ${summary.totals.media.files} files / ${formatBytes(summary.totals.media.bytes)}`,
  );
  lines.push(`DB ${summary.daemon.db_path}`);
  lines.push("");
  lines.push("Peers");
  lines.push(
    table(
      ["status", "name", "tool", "purpose", "inbox", "groups", "updated"],
      summary.peers.map((peer) => [
        peer.online ? "online" : "stale",
        peer.session_name,
        peer.tool,
        peer.purpose ?? "",
        String(peer.pending_inbox),
        String(peer.groups),
        formatRelative(peer.updated_at),
      ]),
    ),
  );
  lines.push("");
  lines.push("Groups");
  lines.push(
    table(
      ["name", "members", "messages", "media", "kind", "last activity"],
      summary.groups.map((group) => [
        group.name,
        `${group.online_members}/${group.members}`,
        String(group.messages),
        String(group.media),
        group.durable ? "durable" : "ephemeral",
        group.last_activity_at ? formatRelative(group.last_activity_at) : "never",
      ]),
    ),
  );
  lines.push("");
  lines.push(`generated: ${summary.generated_at}`);
  return lines.join("\n");
}
