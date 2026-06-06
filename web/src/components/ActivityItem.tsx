// One row in the Activity feed — the compact "row" density the user landed on
// (card/ticket variants were dropped). Memoized so an SSE prepend only mounts
// the new rows. The item `type` is a single generic kind today; `markerIcon`
// keys off the derived mention/reply flags and is the forward-compatible seam
// for future work-event categories (claim/deliver/ship/…).

import { memo, type CSSProperties } from "react";
import type { ActivityItem as ActivityItemModel, Agent, Room } from "../data/types.ts";
import { inkFor, StatusDot } from "./primitives.tsx";
import { useContextMenu } from "./ContextMenu.tsx";

export interface ActivityItemProps {
  item: ActivityItemModel;
  actor: Agent | undefined;
  room: Room | undefined;
  reacted: boolean;
  showRoom?: boolean;
  onReact(item: ActivityItemModel): void;
  onOpenThread(item: ActivityItemModel): void;
  onJumpToRoom(roomId: string, msgId?: string): void;
}

function MarkerIcon({ item }: { item: ActivityItemModel }) {
  if (item.isMention) {
    return (
      <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="4" />
        <path d="M16 8.5 L16 13.2 C16 14.7 17.2 15.4 18.4 14.9 C20.4 14 21 11.5 20.3 9.2 C19 5 14.6 2.8 10.4 3.9 C6 5 3.4 9.4 4.5 13.8 C5.6 18.2 10 20.8 14.4 19.7" />
      </svg>
    );
  }
  if (item.threadParentId) {
    return (
      <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 11.5 C21 15.6 16.97 18.5 12 18.5 C10.8 18.5 9.66 18.33 8.62 18.02 L4 19.5 L5.2 15.7 C4.13 14.5 3.5 13.06 3.5 11.5 C3.5 7.4 7.53 4.5 12 4.5 C16.97 4.5 21 7.4 21 11.5 Z" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 5.5 h16 v10 H9 l-4 3.5 v-3.5 H4 z" />
    </svg>
  );
}

function RoomChip({ room, onJump }: { room: Room; onJump(): void }) {
  const isDm = room.kind === "dm";
  return (
    <button
      className="act-roomchip sm"
      onClick={(e) => { e.stopPropagation(); onJump(); }}
      title={`Go to ${isDm ? room.name : `#${room.name}`}`}
      type="button"
    >
      <span className="act-roomchip-icon" style={{ background: room.color } as CSSProperties}>
        {room.emoji ?? room.name[0]?.toUpperCase() ?? "#"}
      </span>
      <span className="act-roomchip-name">{isDm ? room.name : `#${room.name}`}</span>
    </button>
  );
}

function ActivityPreview({ text }: { text: string }) {
  // Keep Activity rows content-first: no leading "posted in" / "mentioned you"
  // chrome. Mentions are emphasized where they appear in the message body.
  const parts = text.split(/(@(?:you|web:local-human)\b)/gi);
  return (
    <>
      {parts.map((part, index) =>
        /^@(?:you|web:local-human)$/i.test(part)
          ? <mark key={index} className="act-mention-hit">{part}</mark>
          : <span key={index}>{part}</span>
      )}
    </>
  );
}

function ActivityItemImpl({
  item,
  actor,
  room,
  reacted,
  showRoom = true,
  onReact,
  onOpenThread,
  onJumpToRoom,
}: ActivityItemProps) {
  const openMenu = useContextMenu();
  if (!actor) return null;
  const awaits = item.awaiting;

  const onRowClick = () => {
    onOpenThread(item);
  };

  // Row click opens the in-place thread pane. The explicit jump button/context
  // menu are the only affordances that navigate away from Activity.
  return (
    <div
      className={`act-row${awaits ? " awaits" : ""}${item.isNew ? " is-new" : ""}`}
      onClick={onRowClick}
      onContextMenu={(e) =>
        openMenu(e, [
          { label: "Jump to message", onSelect: () => onJumpToRoom(item.roomId, item.msgId) },
          { label: "Open thread here", onSelect: () => onOpenThread(item) },
          { label: reacted ? "Remove reaction" : "React 👍", onSelect: () => onReact(item) },
          { divider: true as const },
          { label: `Focus on ${actor.name}`, onSelect: () => onJumpToRoom(item.roomId, item.msgId) },
        ])
      }
    >
      {awaits && <span className="act-row-bar" />}
      <div className="act-marker sm" style={{ background: actor.color, color: inkFor(actor.color) } as CSSProperties}>
        <MarkerIcon item={item} />
        {actor.status === "busy" && <span className="act-marker-pulse" />}
      </div>
      <span className="author-chip xs" style={{ background: actor.color, color: inkFor(actor.color) } as CSSProperties}>
        {actor.name}
      </span>
      <span className="act-row-text">
        <span className="act-row-preview"><ActivityPreview text={item.text} /></span>
      </span>
      {showRoom && room && <RoomChip room={room} onJump={() => onJumpToRoom(item.roomId)} />}
      <span className="act-time">{relativeTime(item.createdAt)}</span>
      <StatusDot
        status={actor.status}
        size={9}
        className="act-row-presence"
        pulse={actor.status === "busy"}
      />
      <span className="act-row-actions" onClick={(e) => e.stopPropagation()}>
        <button
          className={`act-act-btn react${reacted ? " done" : ""}`}
          onClick={() => onReact(item)}
          title={reacted ? "Reacted 👍 — click to undo. Marks this handled." : "React 👍 — acknowledge without replying. Marks this handled."}
          type="button"
        >
          {reacted ? "✓" : "☺"}
        </button>
        <button
          className="act-act-btn jump"
          onClick={() => onJumpToRoom(item.roomId, item.msgId)}
          title="Jump to room — open this message in its channel."
          type="button"
        >
          ↳
        </button>
      </span>
    </div>
  );
}

function relativeTime(iso: string): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "";
  const secs = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (secs < 45) return "just now";
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.round(hrs / 24);
  return `${days}d`;
}

export const ActivityItem = memo(ActivityItemImpl);
