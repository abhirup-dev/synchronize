import { useAgents } from "../data/context.tsx";
import type { Room } from "../data/types.ts";
import { Avatar, IdentityBadge } from "./primitives.tsx";
import { roomAgents } from "../data/roomAgents.ts";
import type { Agent } from "../data/types.ts";

export type RoomTab = "chat" | "board" | "artifacts";

interface RoomHeaderProps {
  room: Room;
  tab: RoomTab;
  onTab(t: RoomTab): void;
  theme: string;
  themeIcon: string;
  onToggleTheme(shiftKey: boolean): void;
  showAgentsButton?: boolean;
  onOpenAgents?(): void;
  threadBanner?: {
    author: Agent;
    onClose(): void;
  };
}

export function RoomHeader({
  room,
  tab,
  onTab,
  theme,
  themeIcon,
  onToggleTheme,
  showAgentsButton = false,
  onOpenAgents,
  threadBanner,
}: RoomHeaderProps) {
  const agents = useAgents();
  const displayAgents = roomAgents(agents, room);
  const members = room.members.map((id) => displayAgents.find((a) => a.id === id)).filter(Boolean) as import("../data/types.ts").Agent[];
  const working = members.filter((m) => m.status === "busy").length;

  return (
    <header className="room-header">
      <div className="room-header-top">
        <div className="room-id">
          <IdentityBadge as="div" className="room-id-icon" color={room.color}>
            {room.emoji ?? room.name[0]?.toUpperCase() ?? "#"}
          </IdentityBadge>
          <div className="room-id-text">
            <div className="room-title">
              <span className="room-title-name">{room.kind === "group" ? `#${room.name}` : room.name}</span>
            </div>
            {room.description ? <div className="room-topic">{room.description}</div> : null}
          </div>
        </div>

        <div className="room-header-summary">
          <div className="room-meta">
            <span className="busy-inline"><span className="busy-dot" />{working} / {members.length} working</span>
          </div>
        </div>

        <div className="member-pile">
          {members.slice(0, 6).map((a, i) => (
            <span key={a.id} className="member-pile-item" style={{ zIndex: members.length - i }}>
              <Avatar agent={a} size={28} />
            </span>
          ))}
        </div>

        <div className="room-header-actions">
          {showAgentsButton && (
            <button className="icon-btn room-agents-btn" aria-label="open agents" onClick={onOpenAgents}>
              <span className="room-agents-label">AGENTS</span>
              <span className="room-agents-count">{members.length}</span>
            </button>
          )}
          <button
            className="icon-btn theme-toggle"
            onClick={(event) => onToggleTheme(event.shiftKey)}
            title={`${theme} · click toggles light/dark, shift-click cycles variants`}
            aria-label="toggle theme"
          >
            {themeIcon}
          </button>
          <button className="icon-btn" aria-label="pin">📌</button>
          <button className="icon-btn" aria-label="search">🔍</button>
          <button className="icon-btn" aria-label="more">⋯</button>
        </div>
      </div>

      <div className="room-tabs">
        {(["chat", "board", "artifacts"] as RoomTab[]).map((t) => (
          <button
            key={t}
            className={`room-tab${tab === t ? " active" : ""}`}
            onClick={() => onTab(t)}
          >
            {t === "chat" ? "💬 CHAT" : t === "board" ? "▦ BOARD" : "▤ ARTIFACTS"}
          </button>
        ))}
        {threadBanner ? (
          <div className="room-thread-banner" aria-label={`thread replying to ${threadBanner.author.name}`}>
            <div className="room-thread-title">
              <strong>Thread</strong>
              <span className="thread-pane-sep">·</span>
              <span className="thread-pane-sub">replying to</span>
              <IdentityBadge className="author-name room-thread-author" color={threadBanner.author.color}>
                {threadBanner.author.name}
              </IdentityBadge>
            </div>
            <button className="thread-pane-close room-thread-close" onClick={threadBanner.onClose} aria-label="close thread">×</button>
          </div>
        ) : (
          <div className="room-activity">
            ROOM ACTIVITY
            <span className="activity-spark">▁▂▃▅▆▇▆▅▃▂</span>
          </div>
        )}
      </div>
    </header>
  );
}
