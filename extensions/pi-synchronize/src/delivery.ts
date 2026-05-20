import type { Event } from "./client.ts";

export type PiDelivery = "steer" | "followUp" | undefined;

export interface DeliveryContext {
  isIdle?: () => boolean;
}

export function mapEventToDelivery(event: Event, ctx: DeliveryContext): PiDelivery {
  const streaming = !(ctx.isIdle?.() ?? true);
  if (!streaming) return undefined;
  if (event.type === "dm" || event.type === "group_message") return "steer";
  return "followUp";
}

export function formatChannelContent(event: Event): string {
  if (event.type === "dm") return event.body ?? "(direct message)";
  if (event.type === "group_message") return event.body ?? "(group message)";
  if (event.type === "media_shared") return event.body ?? "(media shared)";
  return event.body ?? event.type;
}

function attr(name: string, value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "";
  const escaped = String(value).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return ` ${name}="${escaped}"`;
}

export function formatExternalEvent(event: Event): string {
  const open = [
    "<synchronize_event",
    attr("type", event.type),
    attr("event_id", event.event_id),
    attr("from", event.sender_peer_id),
    attr("to", event.recipient_peer_id),
    attr("group_id", event.group_id),
    attr("media_id", event.media_id),
    attr("sent_at", event.created_at),
    ">",
  ].join("");
  return `${open}\n${formatChannelContent(event)}\n</synchronize_event>`;
}
