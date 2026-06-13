import { useMemo, useState } from "react";
import { cva } from "class-variance-authority";
import { cn } from "../lib/cn.ts";
import { useAgents, useSetAgentColor } from "../data/context.tsx";
import type { Agent, Room } from "../data/types.ts";
import { Avatar, CountChip } from "./primitives.tsx";
import { useContextMenu } from "./ContextMenu.tsx";
import { AgentColorPicker } from "./AgentColorPicker.tsx";
import { AGENTS as SEED_AGENTS } from "../data/seed.ts";
import { roomAgents } from "../data/roomAgents.ts";
import { useToast } from "./Toast.tsx";
import { copyText } from "../utils/clipboard.ts";
import { useArchiveWorkflow } from "./ArchiveRecovery.tsx";

interface AgentRosterProps {
  room: Room;
  focusedAgent: string | null;
  onFocus(id: string | null): void;
  /** Double-clicking a roster card jumps to the agent's last message in the
   *  active room (and toasts when the agent has no messages yet). */
  onAgentDoubleClick?(agentId: string): void;
}

/**
 * Roster styling migrated off extra.css/styles.css to inline Tailwind utilities
 * (tokens bridged through tw.css `@theme inline`). Hooks kept on the elements:
 * `agent-roster` (styles.css `.shell-overlay .agent-roster` + responsive
 * `display:none`), `roster-head` (skin-glass backdrop-filter), `roster-card`
 * (extra.css vim `[data-vim-focused]` ring). The `.roster-card.focused` look
 * comes from the styles.css declaration that leaks through (ink bg / on-ink fg /
 * rule border / accent-pink shadow); extra.css only overrode its transform.
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

const rosterCard = cva(
  [
    "relative grid w-full grid-cols-[32px_1fr] items-start gap-[var(--space-10)]",
    "px-[2px] py-[8px] text-left font-[inherit] text-ink",
    "cursor-pointer bg-transparent shadow-none [border:var(--line-none)] rounded-none",
    "[transition:transform_80ms_ease]",
    "hover:translate-x-px",
  ],
  {
    variants: {
      focused: {
        true: "translate-x-px bg-ink text-on-ink [border-color:var(--rule)] shadow-[var(--shadow-accent-pink)]",
        false: null,
      },
    },
    defaultVariants: { focused: false },
  },
);

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
  const toast = useToast();
  const archive = useArchiveWorkflow();
  const [picker, setPicker] = useState<{ agent: Agent; x: number; y: number } | null>(null);
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
      <div
        className={cn(
          "roster-head flex w-fit items-center gap-[var(--space-10)] bg-lime text-on-accent",
          "mt-0 mr-0 mb-[6px] ml-[4px] px-[14px] py-[8px] font-display text-[length:var(--text-14)]",
          "tracking-[var(--tracking-lg)] [border:var(--line-md)] rounded-none shadow-md [transform:rotate(-2deg)]",
        )}
      >
        <span>AGENTS</span>
        <CountChip n={members.length} />
      </div>
      {focusedAgent && (
        <div className="flex items-center justify-between bg-pink px-[8px] py-[6px] font-mono text-[length:var(--text-11)] text-on-accent [border:var(--line-2)] rounded-sm shadow-chip">
          focused on @{displayAgents.find((a) => a.id === focusedAgent)?.handle}
          <button className="cursor-pointer bg-transparent px-[4px] font-bold text-inherit [border:var(--line-none)]" onClick={() => onFocus(null)}>✕</button>
        </div>
      )}
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
                className={cn("roster-card", rosterCard({ focused: focusedAgent === agent.id }))}
                data-vim-item={`agent-${agent.id}`}
                onClick={() => onFocus(focusedAgent === agent.id ? null : agent.id)}
                onDoubleClick={() => onAgentDoubleClick?.(agent.id)}
                onContextMenu={(e) => {
                  const { clientX, clientY } = e;
                  const copyAoeCommand = agent.aoeSession
                    ? async () => {
                        const copied = await copyText(agent.aoeSession!.attachCommand);
                        toast.show(copied ? "AOE command copied" : "Could not copy AOE command", {
                          kind: copied ? "success" : "error",
                        });
                      }
                    : () => {};
                  const aoeMenuItem = {
                    label: agent.aoeSession ? "Copy AOE attach command" : "AOE session unavailable",
                    ...(agent.aoeSession ? { shortcut: agent.aoeSession.title } : {}),
                    disabled: !agent.aoeSession,
                    onSelect: copyAoeCommand,
                  };
                  openMenu(e, [
                    { label: `Focus on @${agent.handle}`, onSelect: () => onFocus(agent.id) },
                    { label: "Open DM", onSelect: () => console.log("dm", agent.id) },
                    { label: "View profile", onSelect: () => console.log("profile", agent.id) },
                    { divider: true },
                    aoeMenuItem,
                    { divider: true },
                    { label: "Archive session...", disabled: agent.id === "you" || agent.lifecycleState === "archived", onSelect: () => archive.archiveSession(agent) },
                    { label: "Resume session...", disabled: agent.lifecycleState !== "archived", onSelect: () => archive.resumeSession(agent) },
                    { divider: true },
                    { label: "Change color…", onSelect: () => setPicker({ agent, x: clientX, y: clientY }) },
                    {
                      label: "Copy @handle",
                      onSelect: async () => {
                        const copied = await copyText(`@${agent.handle}`);
                        toast.show(copied ? "Handle copied" : "Could not copy handle", {
                          kind: copied ? "success" : "error",
                        });
                      },
                    },
                    { divider: true },
                    { label: "Mute mentions", onSelect: () => console.log("mute", agent.id) },
                  ]);
                }}
              >
                <Avatar agent={agent} size={32} />
                <div>
                  <div className="font-semibold text-[length:var(--text-13)]">{agent.name}</div>
                  <div className="font-mono text-[length:var(--text-10-5)] text-ink-soft">
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
