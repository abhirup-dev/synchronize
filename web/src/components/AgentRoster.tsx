import { useMemo, useState } from "react";
import { useAgents, useSetAgentColor } from "../data/context.tsx";
import type { Agent, Room } from "../data/types.ts";
import { Avatar, CountChip } from "./primitives.tsx";
import { useContextMenu } from "./ContextMenu.tsx";
import { AgentColorPicker } from "./AgentColorPicker.tsx";
import { AGENTS as SEED_AGENTS } from "../data/seed.ts";
import { roomAgents } from "../data/roomAgents.ts";

interface AgentRosterProps {
  room: Room;
  focusedAgent: string | null;
  onFocus(id: string | null): void;
  /** Double-clicking a roster card jumps to the agent's last message in the
   *  active room (and toasts when the agent has no messages yet). */
  onAgentDoubleClick?(agentId: string): void;
}

const GROUPS: Array<{ title: string; status: Agent["status"] }> = [
  { title: "WORKING", status: "busy" },
  { title: "READY", status: "online" },
  { title: "IDLE", status: "idle" },
  { title: "OFF", status: "offline" },
];

export function AgentRoster({ room, focusedAgent, onFocus, onAgentDoubleClick }: AgentRosterProps) {
  const agents = useAgents();
  const displayAgents = useMemo(() => roomAgents(agents, room), [agents, room]);
  const openMenu = useContextMenu();
  const setAgentColor = useSetAgentColor();
  const [picker, setPicker] = useState<{ agent: Agent; x: number; y: number } | null>(null);
  const members = useMemo(
    () => displayAgents.filter((a) => room.members.includes(a.id)),
    [displayAgents, room.members],
  );

  return (
    <aside className="agent-roster" data-vim-panel="roster">
      <div className="roster-head">
        <span>AGENTS</span>
        <CountChip n={members.length} />
      </div>
      {focusedAgent && (
        <div className="focus-banner">
          focused on @{displayAgents.find((a) => a.id === focusedAgent)?.handle}
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
                data-vim-item={`agent-${agent.id}`}
                onClick={() => onFocus(focusedAgent === agent.id ? null : agent.id)}
                onDoubleClick={() => onAgentDoubleClick?.(agent.id)}
                onContextMenu={(e) => {
                  const { clientX, clientY } = e;
                  openMenu(e, [
                    { label: `Focus on @${agent.handle}`, onSelect: () => onFocus(agent.id) },
                    { label: "Open DM", onSelect: () => console.log("dm", agent.id) },
                    { label: "View profile", onSelect: () => console.log("profile", agent.id) },
                    { divider: true },
                    { label: "Change color…", onSelect: () => setPicker({ agent, x: clientX, y: clientY }) },
                    { label: "Copy @handle", onSelect: () => navigator.clipboard?.writeText(`@${agent.handle}`) },
                    { divider: true },
                    { label: "Mute mentions", onSelect: () => console.log("mute", agent.id) },
                  ]);
                }}
              >
                <Avatar agent={agent} size={32} />
                <div className="roster-meta">
                  <div className="roster-name">{agent.name}</div>
                  <div className="roster-role">
                    {agent.role}
                    {agent.statusNote && agent.statusNote !== agent.name ? ` (${agent.statusNote})` : ""}
                  </div>
                </div>
              </button>
            ))}
          </div>
        );
      })}
      {picker && (
        <AgentColorPicker
          x={picker.x}
          y={picker.y}
          currentHex={picker.agent.color}
          defaultHex={SEED_AGENTS.find((a) => a.id === picker.agent.id)?.color ?? picker.agent.color}
          agentName={picker.agent.name}
          onPick={(hex) => { setAgentColor(picker.agent.id, hex); setPicker(null); }}
          onReset={() => { setAgentColor(picker.agent.id, null); setPicker(null); }}
          onClose={() => setPicker(null)}
        />
      )}
    </aside>
  );
}
