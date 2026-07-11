// One row in the Activity feed — the compact "row" density the user landed on
// (card/ticket variants were dropped). Memoized so an SSE prepend only mounts
// the new rows. The item `type` is a single generic kind today; `markerIcon`
// keys off the derived mention/reply flags and is the forward-compatible seam
// for future work-event categories (claim/deliver/ship/…).

import { memo } from "react";
import type { ActivityItem as ActivityItemModel, Agent, Room } from "../data/types.ts";
import { IdentityBadge, IdentityLogoTile, RoomNameInline, StatusDot, roomNameText } from "./primitives.tsx";
import { useContextMenu } from "./ContextMenu.tsx";
import { canShowAgentPreview } from "./AgentPreview.tsx";
import { useToast } from "./Toast.tsx";
import { useArchiveWorkflow } from "./ArchiveRecovery.tsx";
import { agentActionMenuItems } from "./agentActionMenu.ts";
import { MessageKindIcon, messageKindForActivity } from "./MessageKindIcon.tsx";
import { InlineMarkdownPreview } from "./InlineMarkdownPreview.tsx";

export interface ActivityItemProps {
  item: ActivityItemModel;
  actor: Agent | undefined;
  room: Room | undefined;
  reacted: boolean;
  showRoom?: boolean;
  onReact(item: ActivityItemModel): void;
  onOpenThread(item: ActivityItemModel): void;
  onJumpToRoom(roomId: string, msgId?: string): void;
  onViewProfile?(agent: Agent): void;
  onOpenDm?(agentId: string): void;
}

function RoomChip({ room, onJump }: { room: Room; onJump(): void }) {
  const isDm = room.kind === "dm";
  const label = roomNameText(room.kind, room.name);
  return (
    <button
      className="act-roomchip sm"
      onClick={(e) => { e.stopPropagation(); onJump(); }}
      title={`Go to ${label}`}
      type="button"
    >
      {room.kind === "group" ? (
        <IdentityLogoTile className="act-roomchip-icon room-glyph-icon" color={room.color} {...(room.colorRef ? { colorRef: room.colorRef } : null)}>
          {room.emoji ?? "#"}
        </IdentityLogoTile>
      ) : (
        <IdentityBadge className="act-roomchip-icon" color={room.color} {...(room.colorRef ? { colorRef: room.colorRef } : null)}>
          {room.emoji ?? room.name[0]?.toUpperCase() ?? "#"}
        </IdentityBadge>
      )}
      <RoomNameInline kind={room.kind} name={room.name} className="act-roomchip-name" />
    </button>
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
  onViewProfile,
  onOpenDm,
}: ActivityItemProps) {
  const openMenu = useContextMenu();
  const toast = useToast();
  const archive = useArchiveWorkflow();
  if (!actor) return null;
  const awaits = item.awaiting;
  const canViewProfile = Boolean(onViewProfile && canShowAgentPreview(actor));
  const showAuthorChip = room?.kind !== "dm";

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
          ...(canViewProfile
            ? [
                {
                  label: "View profile",
                  onSelect: () => onViewProfile?.(actor),
                },
                { divider: true as const },
              ]
            : []),
        ])
      }
    >
      {awaits && <span className="act-row-bar" />}
      <span
        className="act-message-marker"
        onContextMenu={(e) =>
          openMenu(e, agentActionMenuItems(e, {
            agent: actor,
            toast,
            archive,
            ...(onOpenDm ? { onOpenDm: () => onOpenDm(actor.id) } : {}),
            ...(onViewProfile ? { onViewProfile: () => onViewProfile(actor) } : {}),
          }))
        }
      >
        <MessageKindIcon kind={messageKindForActivity(item, room)} mentioned={item.isMention} size={18} />
      </span>
      {showAuthorChip && (
        <IdentityBadge
          className="author-chip xs identity-name-pill"
          color={actor.color}
          {...(actor.colorRef ? { colorRef: actor.colorRef } : null)}
          onContextMenu={(e) =>
            openMenu(e, agentActionMenuItems(e, {
              agent: actor,
              toast,
              archive,
              ...(onOpenDm ? { onOpenDm: () => onOpenDm(actor.id) } : {}),
              ...(onViewProfile ? { onViewProfile: () => onViewProfile(actor) } : {}),
            }))
          }
        >
          {actor.name}
        </IdentityBadge>
      )}
      <span className="act-row-text">
        <span className="act-row-preview"><InlineMarkdownPreview text={item.text} className="act-inline-markdown" /></span>
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
