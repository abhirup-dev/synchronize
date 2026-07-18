import { useMemo, useState } from "react";
import { cn } from "../lib/cn.ts";
import { useAgents, useMe, useSetAgentColor } from "../data/context.tsx";
import type { Agent, Room } from "../data/types.ts";
import { Avatar, IdentityText, StatusDot } from "./primitives.tsx";
import { useContextMenu } from "./ContextMenu.tsx";
import { AgentColorPicker } from "./AgentColorPicker.tsx";
import { AGENTS as SEED_AGENTS } from "../data/seed.ts";
import { roomAgents } from "../data/roomAgents.ts";
import { isSelfAgent } from "../data/identity.ts";
import { useToast } from "./Toast.tsx";
import { useArchiveWorkflow } from "./ArchiveRecovery.tsx";
import { AgentProfileDialog } from "./AgentPreview.tsx";
import { SpawnAgentDialog } from "./SpawnAgentDialog.tsx";
import { agentActionMenuItems } from "./agentActionMenu.ts";
import { normalizeIdentityColorRef } from "../theme/identity.ts";
import { modelShort } from "../data/models.ts";
import { IconButton } from "./IconButton.tsx";
import { X } from "lucide-react";

interface AgentRosterProps {
  room: Room;
  /** Double-clicking a roster row jumps to the agent's last message in the
   *  active room (and toasts when the agent has no messages yet). */
  onAgentDoubleClick?(agentId: string): void;
  onOpenDm?(agentId: string): void;
  /** Desktop/medium panel: render the ref-style head (Agents · meta · ✕).
   *  Compact omits this — the CompactAppBar above the roster owns the head. */
  onClose?(): void;
}

/**
 * The agents panel (Sigil ref extras.js `.x-panel` / `.x-agrow`): one flat
 * "In this group" list — avatar, hue-tinted name over a mono runtime line,
 * right-aligned mono status — with a primary Spawn button below. Hooks kept:
 * `agent-roster` (styles.css `.shell-overlay` descendant), `roster-head`
 * (structural), `roster-card` (extra.css vim `[data-vim-focused]` ring),
 * `roster-spawn` (unlayered font rule in extra.css — `button { font: inherit }`
 * beats layered font utilities). */

const STATUS_LABEL: Record<Agent["status"], string> = {
  busy: "WORKING",
  online: "READY",
  idle: "IDLE",
  offline: "OFF",
};

function agentPanelLine(agent: Agent): string {
  const model = agent.runtimeDetails?.model;
  return [agent.runtimeDetails?.tool, model ? modelShort(model) : undefined, agent.role]
    .filter(Boolean)
    .join(" · ");
}

function defaultAgentColorRef(agent: Agent) {
  const seeded = SEED_AGENTS.find((candidate) => candidate.id === agent.id);
  return seeded?.colorRef ?? normalizeIdentityColorRef(seeded?.color ?? agent.color, agent.id);
}

export function AgentRoster({ room, onAgentDoubleClick, onOpenDm, onClose }: AgentRosterProps) {
  const agents = useAgents();
  const me = useMe();
  const openMenu = useContextMenu();
  const setAgentColor = useSetAgentColor();
  const toast = useToast();
  const archive = useArchiveWorkflow();
  const [picker, setPicker] = useState<{ agent: Agent; x: number; y: number } | null>(null);
  const [profileAgent, setProfileAgent] = useState<Agent | null>(null);
  const [spawnOpen, setSpawnOpen] = useState(false);
  // The panel lists real agents only — the operator is not crew (ref parity).
  const members = useMemo(
    () => roomAgents(agents, room).filter((a) => room.members.includes(a.id) && !isSelfAgent(a, me)),
    [agents, room, me],
  );
  const working = members.filter((a) => a.status === "busy").length;

  return (
    <aside className="agent-roster flex min-h-0 flex-col" data-vim-panel="roster">
      {onClose ? (
        <header className="roster-head flex items-start gap-[12px] px-[18px] pt-[16px] pb-[12px] [border-bottom:var(--line)]">
          <div className="min-w-0">
            <h2 className="m-0 font-ui text-[length:var(--text-14-5)] font-extrabold leading-[1.2]">Agents</h2>
            <div className="mt-[2px] font-mono text-[length:var(--text-9-5)] tracking-[0.08em] uppercase text-ink-faint whitespace-nowrap overflow-hidden text-ellipsis">
              {room.kind === "group" ? `# ${room.name}` : room.name} · {members.length} agents · {working} working
            </div>
          </div>
          <IconButton icon={X} label="close agents panel" size={28} iconSize={15} className="ml-auto flex-none" onClick={onClose} />
        </header>
      ) : null}
      <div className="flex-1 min-h-0 overflow-y-auto px-[11px] pt-[6px] pb-[16px]">
        <div className="mt-[16px] mb-[7px] px-[7px] font-mono text-[length:var(--text-9)] font-bold tracking-[0.2em] uppercase text-ink-faint">
          In this group
        </div>
        {members.map((agent) => (
          <button
            key={agent.id}
            type="button"
            className={cn(
              "roster-card flex w-full items-center gap-[11px] px-[7px] py-[8px] text-left",
              "bg-transparent [border:var(--line-none)] rounded-[9px] cursor-pointer hover:bg-paper-3",
              agent.lifecycleState === "archived" && "opacity-50",
            )}
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
            <Avatar agent={agent} size={34} showStatus />
            <span className="flex min-w-0 flex-col">
              <IdentityText
                color={agent.color}
                {...(agent.colorRef ? { colorRef: agent.colorRef } : {})}
                className="text-[length:var(--text-13)] font-bold leading-[1.25] whitespace-nowrap overflow-hidden text-ellipsis"
              >
                {agent.name}
              </IdentityText>
              {/* ref .x-agrow .hn wraps rather than truncating. */}
              <span className="mt-[2px] font-mono text-[length:var(--text-9)] tracking-[0.08em] uppercase text-ink-faint leading-[1.5]">
                {agentPanelLine(agent)}
              </span>
            </span>
            <span className="ml-auto flex-none inline-flex items-center gap-[6px] font-mono text-[length:var(--text-9-5)] font-semibold tracking-[0.08em] text-ink-soft whitespace-nowrap">
              <StatusDot status={agent.status} size={7} />
              {STATUS_LABEL[agent.status]}
            </span>
          </button>
        ))}
        <div className="mt-[16px] px-[7px]">
          <button
            type="button"
            className="roster-spawn bg-[color:var(--accent)] text-[color:var(--paper)] [border:1px_solid_var(--accent)] rounded-[9px] px-[14px] py-[8px] cursor-pointer hover:[filter:brightness(1.08)]"
            onClick={() => setSpawnOpen(true)}
          >
            + Spawn agent
          </button>
        </div>
      </div>
      {picker && (
        <AgentColorPicker
          x={picker.x}
          y={picker.y}
          currentRef={picker.agent.colorRef ?? normalizeIdentityColorRef(picker.agent.color, picker.agent.id)}
          defaultRef={defaultAgentColorRef(picker.agent)}
          agentName={picker.agent.name}
          onPick={(ref) => { setAgentColor(picker.agent.id, ref); setPicker(null); }}
          onReset={() => { setAgentColor(picker.agent.id, null); setPicker(null); }}
          onClose={() => setPicker(null)}
        />
      )}
      <AgentProfileDialog agent={profileAgent} onClose={() => setProfileAgent(null)} />
      {spawnOpen && <SpawnAgentDialog room={room} onClose={() => setSpawnOpen(false)} />}
    </aside>
  );
}
