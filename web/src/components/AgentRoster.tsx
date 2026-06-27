import { useMemo, useState } from "react";
import { cva } from "class-variance-authority";
import { cn } from "../lib/cn.ts";
import { useAgents, useSetAgentColor } from "../data/context.tsx";
import type { Agent, Room } from "../data/types.ts";
import { Avatar, CountChip, PanelSectionHeader } from "./primitives.tsx";
import { useContextMenu } from "./ContextMenu.tsx";
import { AgentColorPicker } from "./AgentColorPicker.tsx";
import { AGENTS as SEED_AGENTS } from "../data/seed.ts";
import { roomAgents } from "../data/roomAgents.ts";
import { useToast } from "./Toast.tsx";
import { useArchiveWorkflow } from "./ArchiveRecovery.tsx";
import { AgentProfileDialog } from "./AgentPreview.tsx";
import { agentActionMenuItems } from "./agentActionMenu.ts";
import { phaseLabel, workStateSummary } from "../workState.ts";

interface AgentRosterProps {
  room: Room;
  /** Double-clicking a roster card jumps to the agent's last message in the
   *  active room (and toasts when the agent has no messages yet). */
  onAgentDoubleClick?(agentId: string): void;
  onOpenDm?(agentId: string): void;
}

/**
 * Roster styling migrated off extra.css/styles.css to inline Tailwind utilities
 * (tokens bridged through tw.css `@theme inline`). Hooks kept on the elements:
 * `agent-roster` (styles.css `.shell-overlay .agent-roster` + responsive
 * `display:none`), `roster-head` (skin-glass backdrop-filter), and
 * `roster-card` (extra.css vim `[data-vim-focused]` ring).
 */
const rosterSection = cva("flex flex-col gap-[6px]", {
  variants: {
    status: {
      busy: "pl-[6px] [border-left:2px_solid_var(--pink)]",
      online: null,
      idle: null,
      offline: null,
    },
  },
});

const rosterCard = cva([
  "relative grid w-full grid-cols-[32px_1fr] items-start gap-[var(--space-10)]",
  "px-[2px] py-[8px] text-left font-[inherit] text-ink",
  "cursor-pointer bg-transparent shadow-none [border:var(--line-none)] rounded-none",
  "[transition:transform_80ms_ease]",
  "hover:translate-x-px",
]);

const GROUPS: Array<{ title: string; status: Agent["status"] }> = [
  { title: "WORKING", status: "busy" },
  { title: "READY", status: "online" },
  { title: "IDLE", status: "idle" },
  { title: "OFF", status: "offline" },
];

export function AgentRoster({ room, onAgentDoubleClick, onOpenDm }: AgentRosterProps) {
  const agents = useAgents();
  const displayAgents = useMemo(() => roomAgents(agents, room), [agents, room]);
  const openMenu = useContextMenu();
  const setAgentColor = useSetAgentColor();
  const toast = useToast();
  const archive = useArchiveWorkflow();
  const [picker, setPicker] = useState<{ agent: Agent; x: number; y: number } | null>(null);
  const [profileAgent, setProfileAgent] = useState<Agent | null>(null);
  const members = useMemo(
    () => displayAgents.filter((a) => room.members.includes(a.id)),
    [displayAgents, room.members],
  );

  return (
    <aside
      className={cn(
        "agent-roster flex min-h-0 flex-col gap-[var(--space-14)] overflow-y-auto",
        "px-[14px] pt-[14px] pb-[18px] [border-left:var(--line-2)]",
      )}
      data-vim-panel="roster"
    >
      <PanelSectionHeader className="roster-head" label="AGENTS" count={members.length} />
      {GROUPS.map(({ title, status }) => {
        const inGroup = members.filter((m) => m.status === status);
        if (inGroup.length === 0) return null;
        return (
          <div key={title} className={cn(rosterSection({ status }))}>
            <div className="flex items-center gap-[var(--space-6)] font-display text-[length:var(--text-10)] tracking-[var(--tracking-md)] text-ink-soft">
              <span>● {title}</span>
              <CountChip n={inGroup.length} />
            </div>
            {inGroup.map((agent) => (
              <button
                key={agent.id}
                className={cn("roster-card", rosterCard())}
                data-vim-item={`agent-${agent.id}`}
                onDoubleClick={() => onAgentDoubleClick?.(agent.id)}
                onContextMenu={(e) => {
                  openMenu(e, agentActionMenuItems(e, {
                    agent,
                    toast,
                    archive,
                    ...(onOpenDm ? { onOpenDm: () => onOpenDm(agent.id) } : {}),
                    onViewProfile: () => setProfileAgent(agent),
                    onChangeColor: ({ x, y }) => setPicker({ agent, x, y }),
                  }));
                }}
              >
                <Avatar agent={agent} size={32} />
                <div>
                  <div className="font-semibold text-[length:var(--text-13)]">{agent.name}</div>
                  <div className="font-mono text-[length:var(--text-10-5)] text-ink-soft">
                    {agent.role}
                    {agent.statusNote && agent.statusNote !== agent.name ? ` (${agent.statusNote})` : ""}
                  </div>
                  <RosterWorkState agent={agent} />
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
      <AgentProfileDialog agent={profileAgent} onClose={() => setProfileAgent(null)} />
    </aside>
  );
}

function RosterWorkState({ agent }: { agent: Agent }) {
  const summary = workStateSummary(agent);
  if (!summary) return null;
  const stale = !agent.workState && agent.workStateStatus?.state === "stale";
  return (
    <div className="mt-[5px] flex min-w-0 items-center gap-[6px] font-mono text-[length:var(--text-10)] leading-[1.2] text-ink-soft">
      <span
        className={cn(
          "shrink-0 rounded-[4px] px-[5px] py-[1px] uppercase [border:var(--control-border)]",
          stale ? "text-ink-faint" : agent.workState?.phase === "blocked" ? "text-danger" : "text-ink",
        )}
      >
        {agent.workState ? phaseLabel(agent.workState.phase) : "Stale"}
      </span>
      <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap" title={summary}>
        {agent.workState?.task ?? agent.workState?.summary ?? "expired"}
      </span>
    </div>
  );
}
