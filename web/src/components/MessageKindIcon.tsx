import { AtSign, CornerUpRight, MessageCircle, MessagesSquare } from "lucide-react";

import type { ActivityItem, Room } from "../data/types.ts";
import { cn } from "../lib/cn.ts";

export type MessageKind = "dm" | "thread-reply" | "thread-root";

export function messageKindForActivity(item: ActivityItem, room: Room | undefined): MessageKind {
  if (room?.kind === "dm") return "dm";
  if (item.threadParentId) return "thread-reply";
  return "thread-root";
}

const LABELS: Record<MessageKind, string> = {
  dm: "direct message",
  "thread-reply": "thread reply",
  "thread-root": "top-level message",
};

export function MessageKindIcon({
  kind,
  mentioned = false,
  className,
  size = 16,
  strokeWidth = 2,
}: {
  kind: MessageKind;
  mentioned?: boolean;
  className?: string;
  size?: number;
  strokeWidth?: number;
}) {
  const Icon = kind === "dm" ? MessageCircle : kind === "thread-reply" ? CornerUpRight : MessagesSquare;
  return (
    <span className={cn("message-kind-icon", className)} aria-label={LABELS[kind]} title={LABELS[kind]}>
      <Icon size={size} strokeWidth={strokeWidth} aria-hidden />
      {mentioned && (
        <span className="message-kind-mention" aria-label="mentions you" title="mentions you">
          <AtSign size={9} strokeWidth={2.4} aria-hidden />
        </span>
      )}
    </span>
  );
}
