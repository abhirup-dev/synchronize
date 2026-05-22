import { useMemo } from "react";
import { useAgents } from "../data/context.tsx";
import type { Agent, Room } from "../data/types.ts";
import { Avatar, CountChip } from "./primitives.tsx";
import { useContextMenu } from "./ContextMenu.tsx";

interface AgentRosterProps {
  room: Room;
  focusedAgent: string | null;
  onFocus(id: string | null): void;
}

const GROUPS: Array<{ title: string; status: Agent["status"] }> = [
  { title: "WORKING", status: "busy" },
  { title: "READY", status: "online" },
  { title: "IDLE", status: "idle" },
  { title: "OFF", status: "offline" },
];

export function AgentRoster({ room, focusedAgent, onFocus }: AgentRosterProps) {
  const agents = useAgents();
  const openMenu = useContextMenu();
  const members = useMemo(
    () => agents.filter((a) => room.members.includes(a.id)),
    [agents, room.members],
  );

  return (
    <aside className="agent-roster">
      <div className="roster-head">
        <span>AGENTS</span>
        <CountChip n={members.length} />
      </div>
      {focusedAgent && (
        <div className="focus-banner">
          focused on @{agents.find((a) => a.id === focusedAgent)?.handle}
          <button className="focus-clear" onClick={() => onFocus(null)}>✕</button>
        </div>
      )}
      {GROUPS.map(({ title, status }) => {
        const inGroup = members.filter((m) => m.status === status);
        if (inGroup.length === 0) return null;
        return (
          <div key={title} className={`roster-section roster-${status}`}>
            <div className="roster-section-head">
              <span>● {title}</span>
              <CountChip n={inGroup.length} />
            </div>
            {inGroup.map((agent) => (
              <button
                key={agent.id}
                className={`roster-card${focusedAgent === agent.id ? " focused" : ""}`}
                onClick={() => onFocus(focusedAgent === agent.id ? null : agent.id)}
                onContextMenu={(e) =>
                  openMenu(e, [
                    { label: `Focus on @${agent.handle}`, onSelect: () => onFocus(agent.id) },
                    { label: "Open DM", onSelect: () => console.log("dm", agent.id) },
                    { label: "View profile", onSelect: () => console.log("profile", agent.id) },
                    { divider: true },
                    { label: "Copy @handle", onSelect: () => navigator.clipboard?.writeText(`@${agent.handle}`) },
                    { divider: true },
                    { label: "Mute mentions", onSelect: () => console.log("mute", agent.id) },
                  ])
                }
              >
                <Avatar agent={agent} size={32} />
                <div className="roster-meta">
                  <div className="roster-name">{agent.name}</div>
                  <div className="roster-role">{agent.role}</div>
                  {agent.statusNote && <div className="roster-note">— {agent.statusNote}</div>}
                </div>
              </button>
            ))}
          </div>
        );
      })}
    </aside>
  );
}
