import { useAgents } from "../data/context.tsx";
import type { Room } from "../data/types.ts";
import { Avatar, Sticker, inkFor } from "./primitives.tsx";
import { roomAgents } from "../data/roomAgents.ts";

export type RoomTab = "chat" | "board" | "artifacts";

interface RoomHeaderProps {
  room: Room;
  tab: RoomTab;
  onTab(t: RoomTab): void;
}

export function RoomHeader({ room, tab, onTab }: RoomHeaderProps) {
  const agents = useAgents();
  const displayAgents = roomAgents(agents, room);
  const members = room.members.map((id) => displayAgents.find((a) => a.id === id)).filter(Boolean) as import("../data/types.ts").Agent[];
  const working = members.filter((m) => m.status === "busy").length;

  return (
    <header className="room-header">
      <div className="room-header-top">
        <div className="room-id">
          <div className="room-id-icon" style={{ background: room.color, color: inkFor(room.color) }}>
            {room.emoji ?? room.name[0]?.toUpperCase() ?? "#"}
          </div>
          <div className="room-id-text">
            <div className="room-title">
              {room.kind === "group" ? `#${room.name}` : room.name}{" "}
              <Sticker label={room.kind.toUpperCase()} color="var(--yellow)" tilt={-2} />
            </div>
            <div className="room-meta">
              <span>{members.length} member{members.length === 1 ? "" : "s"}</span>
              {working > 0 ? (
                <>
                  <span className="dot-sep">•</span>
                  <span className="busy-inline"><span className="busy-dot" />{working} working</span>
                </>
              ) : null}
            </div>
            {room.description ? <div className="room-topic">{room.description}</div> : null}
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
        <div className="room-activity">
          ROOM ACTIVITY
          <span className="activity-spark">▁▂▃▅▆▇▆▅▃▂</span>
        </div>
      </div>
    </header>
  );
}
