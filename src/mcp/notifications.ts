import type { Event } from "../api/types.ts";
import type { NotificationSink, NotifyMode } from "./state.ts";
import { log } from "./util.ts";

export async function emitMcpNotification(sink: NotificationSink, mode: NotifyMode, event: Event): Promise<void> {
  if (mode === "claude") {
    log(`sending Claude channel notification event_id=${event.event_id} meta=${JSON.stringify(formatClaudeChannelMeta(event))}`);
    await sink.notification({
      method: "notifications/claude/channel",
      params: {
        content: formatChannelContent(event),
        meta: formatClaudeChannelMeta(event),
      },
    });
    log(`sent Claude channel notification event_id=${event.event_id}`);
    return;
  }
  log(`sending Codex logging notification event_id=${event.event_id}`);
  await sink.sendLoggingMessage({
    level: "notice",
    logger: "synchronize",
    data: event,
  });
  log(`sent Codex logging notification event_id=${event.event_id}`);
}

export function formatClaudeChannelMeta(event: Event): Record<string, string> {
  const meta: Record<string, string> = {
    event_id: String(event.event_id),
    type: event.type,
    sent_at: event.created_at,
  };
  if (event.sender_peer_id) {
    meta.from_id = event.sender_peer_id;
    meta.sender_peer_id = event.sender_peer_id;
  }
  if (event.recipient_peer_id) meta.recipient_peer_id = event.recipient_peer_id;
  if (event.group_id !== null) meta.group_id = String(event.group_id);
  if (event.media_id) meta.media_id = event.media_id;
  return meta;
}

export function formatChannelContent(event: Event): string {
  if (event.type === "dm") return event.body ?? "(direct message)";
  if (event.type === "group_message") return event.body ?? "(group message)";
  if (event.type === "media_shared") return event.body ?? "(media shared)";
  return event.body ?? event.type;
}
