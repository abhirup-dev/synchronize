import { useDeferredValue, useMemo, useState, type CSSProperties } from "react";
import { useMe, useRooms, useAgents } from "../data/context.tsx";
import { StatusDot, inkFor } from "./primitives.tsx";
import type { Room } from "../data/types.ts";
import { useContextMenu } from "./ContextMenu.tsx";
import { useAutoScrollbar } from "../hooks/useAutoScrollbar.ts";
import { SpawnAgentDialog } from "./SpawnAgentDialog.tsx";

interface SidebarProps {
  activeRoomId: string;
  onSelect(id: string): void;
  mode?: "navigate" | "typing";
}

export function Sidebar({ activeRoomId, onSelect, mode = "navigate" }: SidebarProps) {
  const rooms = useRooms();
  const me = useMe();
  const agents = useAgents();
  const [filter, setFilter] = useState("");
  const deferredFilter = useDeferredValue(filter);

  const filtered = useMemo(() => {
    const f = deferredFilter.trim().toLowerCase();
    if (!f) return rooms;
    return rooms.filter((r) => r.name.toLowerCase().includes(f));
  }, [rooms, deferredFilter]);

  const allGroups = rooms.filter((r) => r.kind === "group");
  const allDms = rooms.filter((r) => r.kind === "dm");
  const groups = filtered.filter((r) => r.kind === "group");
  const dms = filtered.filter((r) => r.kind === "dm");

  const groupCount = allGroups.length;
  const dmCount = allDms.length;
  const groupsScrollRef = useAutoScrollbar<HTMLDivElement>();
  const dmsScrollRef = useAutoScrollbar<HTMLDivElement>();
  const openMenu = useContextMenu();
  const [spawnRoom, setSpawnRoom] = useState<Room | null>(null);

  return (
    <aside className="sidebar" data-vim-panel="sidebar">
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
          <span className="count-chip">{groupCount}</span>
          <button className="plus-btn" title="new group" aria-label="new group">+</button>
        </div>
        <div className="list autoscroll" ref={groupsScrollRef}>
          {groups.map((r) => (
            <RoomItem key={r.id} room={r} active={r.id === activeRoomId} onSelect={onSelect} onSpawnAgent={setSpawnRoom} />
          ))}
        </div>
      </section>

      <section className="sidebar-section">
        <div className="section-head">
          DMs
          <span className="count-chip">{dmCount}</span>
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
              {...(other?.color ? { otherColor: other.color } : {})}
              />
            );
          })}
        </div>
      </section>

      <button
        type="button"
        className="user-bubble"
        title={`${me.name} · @${me.handle}`}
        onClick={() => console.log("user-bubble click", me.id)}
        onContextMenu={(e) =>
          openMenu(e, [
            { label: `Signed in as ${me.name}`, onSelect: () => console.log("profile", me.id) },
            { divider: true },
            { label: "Set status: ready",   onSelect: () => console.log("status online") },
            { label: "Set status: working", onSelect: () => console.log("status busy") },
            { label: "Set status: idle",    onSelect: () => console.log("status idle") },
            { divider: true },
            { label: "Copy @handle", onSelect: () => navigator.clipboard?.writeText(`@${me.handle}`) },
            { label: "View profile", onSelect: () => console.log("profile", me.id) },
            { divider: true },
            { label: "Sign out", danger: true, onSelect: () => console.log("sign out") },
          ])
        }
      >
        <span className="user-bubble-avatar">{me.avatar}</span>
        <StatusDot status={me.status} size={11} />
        <span className={`vim-mode-chip vim-mode-${mode}`} aria-label={`vim mode: ${mode}`}>
          {mode === "navigate" ? "NAV" : "INS"}
        </span>
      </button>
      {spawnRoom && <SpawnAgentDialog room={spawnRoom} onClose={() => setSpawnRoom(null)} />}
    </aside>
  );
}

function RoomItem({
  room,
  active,
  onSelect,
  onSpawnAgent,
  otherStatus,
  otherColor,
}: {
  room: Room;
  active: boolean;
  onSelect(id: string): void;
  onSpawnAgent?(room: Room): void;
  otherStatus?: import("../data/types.ts").AgentStatus;
  otherColor?: string;
}) {
  const openMenu = useContextMenu();
  const iconColor = otherColor ?? room.color;
  const iconInk = inkFor(iconColor);
  return (
    <button
      className={`room-item${active ? " active" : ""}`}
      data-vim-item={`room-${room.id}`}
      onClick={() => onSelect(room.id)}
      onContextMenu={(e) =>
        openMenu(e, [
          ...(room.kind === "group" && onSpawnAgent
            ? [{ label: "Spawn agent...", onSelect: () => onSpawnAgent(room) }]
            : []),
          ...(room.kind === "group" && onSpawnAgent ? [{ divider: true as const }] : []),
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
      <div
        className="room-icon identity-icon"
        style={{
          background: iconColor,
          color: iconInk,
        } as CSSProperties}
      >
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
