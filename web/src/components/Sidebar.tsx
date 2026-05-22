import { useMemo, useState } from "react";
import { useMe, useRooms, useAgents } from "../data/context.tsx";
import { StatusDot } from "./primitives.tsx";
import type { Room } from "../data/types.ts";
import { useContextMenu } from "./ContextMenu.tsx";
import { useAutoScrollbar } from "../hooks/useAutoScrollbar.ts";

interface SidebarProps {
  activeRoomId: string;
  onSelect(id: string): void;
}

export function Sidebar({ activeRoomId, onSelect }: SidebarProps) {
  const rooms = useRooms();
  const me = useMe();
  const agents = useAgents();
  const [filter, setFilter] = useState("");

  const filtered = useMemo(() => {
    const f = filter.trim().toLowerCase();
    if (!f) return rooms;
    return rooms.filter((r) => r.name.toLowerCase().includes(f));
  }, [rooms, filter]);

  const groups = filtered.filter((r) => r.kind === "group");
  const dms = filtered.filter((r) => r.kind === "dm");

  const groupUnread = groups.reduce((acc, r) => acc + r.unread, 0);
  const dmUnread = dms.reduce((acc, r) => acc + r.unread, 0);
  const groupsScrollRef = useAutoScrollbar<HTMLDivElement>();
  const dmsScrollRef = useAutoScrollbar<HTMLDivElement>();

  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">S</div>
        <div className="brand-text">
          <div className="brand-name">SYNCHRONIZE</div>
          <div className="brand-sub">/ agent ops chat</div>
        </div>
      </div>

      <div className="searchbox">
        <input
          type="text"
          placeholder="search rooms…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <span className="search-key">⌘K</span>
      </div>

      <section className="sidebar-section">
        <div className="section-head">
          GROUPS
          <span className="count-chip">{groupUnread}</span>
          <button className="plus-btn" title="new group" aria-label="new group">+</button>
        </div>
        <div className="list autoscroll" ref={groupsScrollRef}>
          {groups.map((r) => (
            <RoomItem key={r.id} room={r} active={r.id === activeRoomId} onSelect={onSelect} />
          ))}
        </div>
      </section>

      <section className="sidebar-section">
        <div className="section-head">
          DIRECT MESSAGES
          <span className="count-chip">{dmUnread}</span>
          <button className="plus-btn" title="new dm" aria-label="new dm">+</button>
        </div>
        <div className="list autoscroll" ref={dmsScrollRef}>
          {dms.map((r) => {
            const other = agents.find((a) => a.id === r.peerId);
            return (
              <RoomItem
                key={r.id}
                room={r}
                active={r.id === activeRoomId}
                onSelect={onSelect}
                {...(other?.status ? { otherStatus: other.status } : {})}
              />
            );
          })}
        </div>
      </section>

      <div className="user-footer">
        <div className="avatar" style={{
          width: 36, height: 36, background: "var(--paper)", color: "var(--ink)",
          border: "2.5px solid var(--ink)", borderRadius: 6, display: "grid", placeItems: "center",
          fontFamily: "Archivo Black, sans-serif", fontSize: 14, boxShadow: "1.5px 1.5px 0 var(--ink)",
        }}>{me.avatar}</div>
        <div className="user-info">
          <div className="user-name">{me.name}</div>
          <div className="user-handle">@{me.handle} · online</div>
        </div>
        <StatusDot status={me.status} size={10} />
      </div>
    </aside>
  );
}

function RoomItem({
  room,
  active,
  onSelect,
  otherStatus,
}: {
  room: Room;
  active: boolean;
  onSelect(id: string): void;
  otherStatus?: import("../data/types.ts").AgentStatus;
}) {
  const openMenu = useContextMenu();
  return (
    <button
      className={`room-item${active ? " active" : ""}`}
      onClick={() => onSelect(room.id)}
      onContextMenu={(e) =>
        openMenu(e, [
          { label: "Mark as read", onSelect: () => console.log("read", room.id) },
          { label: room.pinned ? "Unpin" : "Pin to top", onSelect: () => console.log("pin", room.id) },
          { label: "Mute notifications", onSelect: () => console.log("mute", room.id) },
          { divider: true },
          { label: "Copy room id", onSelect: () => navigator.clipboard?.writeText(room.id) },
          { divider: true },
          { label: room.kind === "group" ? "Leave group" : "Close DM", danger: true, onSelect: () => console.log("leave", room.id) },
        ])
      }
    >
      <div className="room-icon" style={{ background: room.color }}>
        <span>{room.emoji ?? room.name[0]?.toUpperCase() ?? "#"}</span>
        {otherStatus && (
          <span
            className="room-status-dot"
            style={{
              background:
                otherStatus === "online" ? "var(--lime)" :
                otherStatus === "busy"   ? "var(--pink)" :
                otherStatus === "idle"   ? "var(--yellow)" : "var(--muted)",
            }}
          />
        )}
      </div>
      <div className="room-body">
        <div className="room-name-row">
          <div className="room-name">{room.kind === "group" ? `#${room.name}` : room.name}</div>
          {room.pinned && <span className="pin">📌</span>}
        </div>
        <div className="room-preview">{room.lastPreview}</div>
      </div>
      {room.unread > 0 && <span className="unread">{room.unread}</span>}
    </button>
  );
}
