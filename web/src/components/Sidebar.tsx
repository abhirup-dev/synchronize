import { useDeferredValue, useMemo, useState, type KeyboardEvent } from "react";
import { cva } from "class-variance-authority";
import { cn } from "../lib/cn.ts";
import { useMe, useRooms, useAgents, useActivityAwaitingCount } from "../data/context.tsx";
import { IdentityBadge, StatusDot } from "./primitives.tsx";
import type { Agent, Room } from "../data/types.ts";
import { useContextMenu } from "./ContextMenu.tsx";
import { useAutoScrollbar } from "../hooks/useAutoScrollbar.ts";
import { SpawnAgentDialog } from "./SpawnAgentDialog.tsx";
import { useArchiveWorkflow } from "./ArchiveRecovery.tsx";
import { AgentProfileDialog } from "./AgentPreview.tsx";
import { useToast } from "./Toast.tsx";
import { agentActionMenuItems } from "./agentActionMenu.ts";

/**
 * Tokens flow from the styles.css contract via the tw.css `@theme inline`
 * bridge; values without a utility namespace (border shorthand, per-property
 * transitions, tracking/space/text tokens) use arbitrary values. Skin-hook
 * classes (`sidebar`, `brand-mark`, `section-head`, `room-item`+states) are
 * retained alongside the utilities — their base declarations moved here, but
 * the state/`[data-theme]` override rules still live in styles.css. */

// Shared icon-plus button (groups/DMs section heads). No variants → constant.
const PLUS_BTN =
  "ml-auto w-[22px] h-[22px] bg-paper text-ink [border:var(--line-2)] rounded-sm shadow-sm font-black text-[length:var(--text-14)] leading-[0] p-0 hover:translate-x-[-1px] hover:translate-y-[-1px] hover:shadow-hover";

// Room tile. Keeps the `room-item` hook so skin-glass.css + useVimNav's
// `.active` lookup + the .active/.archived/[data-theme] state rules still bind.
const roomItem = cva([
  "room-item flex items-center gap-[var(--space-11)] px-[10px] py-[9px] bg-transparent",
  "[border:var(--line-md-transparent)] rounded-lg text-left text-ink relative cursor-pointer",
  "[transition:transform_80ms,box-shadow_80ms]",
]);

const vimModeChip = cva(
  [
    "absolute top-[-10px] left-1/2 -translate-x-1/2 font-display text-[length:var(--text-8)]",
    "tracking-[var(--tracking-lg)] p-[var(--space-chip-pad-sm)] [border:var(--line-xs-ink)] rounded-pill pointer-events-none",
  ],
  {
    variants: {
      mode: {
        navigate: "bg-tangerine text-ink",
        typing: "bg-lime text-ink",
      },
    },
    defaultVariants: { mode: "navigate" },
  },
);

// Keeps the `activity-dock-btn` hook so the `.active` + [data-theme] override
// rules (incl. kanagawa hover/active) in styles.css still bind. The `.active`
// hover/transform parity lives in those CSS rules; base visuals are utilities.
const activityDockBtn = cva([
  "activity-dock-btn relative flex-[0_0_40px] w-[40px] h-[40px] grid place-items-center bg-paper text-ink",
  "[border:var(--line-md)] rounded-md shadow-sm p-0 cursor-pointer",
  "[transition:transform_80ms_ease,box-shadow_80ms_ease,background_80ms_ease]",
  "hover:translate-x-[-1px] hover:translate-y-[-1px] hover:shadow-hover hover:bg-paper-3",
]);

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
  const [profileAgent, setProfileAgent] = useState<Agent | null>(null);
  const awaitingCount = useActivityAwaitingCount();
  const archive = useArchiveWorkflow();

  return (
    <aside
      className={cn("sidebar", "flex flex-col overflow-hidden relative bg-paper-2")}
      data-vim-panel="sidebar"
    >
      <div className="sidebar-brand flex items-center gap-[var(--space-12)] px-[16px] pt-[18px] pb-[14px] [border-bottom:var(--line)]">
        <div className={cn("brand-mark", "w-[42px] h-[42px] bg-yellow [border:var(--line)] grid place-items-center font-display text-[length:var(--text-22)] shadow-sm rotate-[-3deg]")}>
          S
        </div>
        <div className="leading-[1.1]">
          <div className="font-display text-[length:var(--text-17)] tracking-[var(--tracking-tight)]">SYNCHRONIZE</div>
          <div className="font-mono text-[length:var(--text-10)] text-ink-soft mt-[2px]">/ agent ops chat</div>
        </div>
      </div>

      <div className="relative m-[14px]">
        <input
          type="text"
          className="w-full font-[inherit] text-[length:var(--text-13)] pt-[9px] pr-[38px] pb-[9px] pl-[12px] bg-paper text-ink [border:var(--line-2)] rounded-sm shadow-sm outline-none placeholder:text-ink-faint focus:border-rule focus:shadow-hover focus:translate-x-[-1px] focus:translate-y-[-1px]"
          placeholder="search rooms…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <span className="sidebar-search-shortcut absolute right-[8px] top-1/2 -translate-y-1/2 font-mono text-[length:var(--text-10)] bg-paper-3 [border:var(--line-xs)] p-[var(--space-chip-pad-xs)] rounded-xs">⌘K</span>
      </div>

      <section className="sidebar-section">
        <div className={cn("section-head", "flex items-center gap-[var(--space-8)] px-[16px] pt-[14px] pb-[8px] font-display text-[length:var(--text-12)] tracking-[var(--tracking-md)] text-ink rotate-[-1.5deg] origin-left")}>
          GROUPS
          <span className="count-chip">{groupCount}</span>
          <button className={PLUS_BTN} title="new group" aria-label="new group">+</button>
        </div>
        <div className="list autoscroll" ref={groupsScrollRef}>
          {groups.map((r) => (
            <RoomItem key={r.id} room={r} active={r.id === activeRoomId} onSelect={onSelect} onSpawnAgent={setSpawnRoom} />
          ))}
        </div>
      </section>

      <section className="sidebar-section">
        <div className={cn("section-head", "flex items-center gap-[var(--space-8)] px-[16px] pt-[14px] pb-[8px] font-display text-[length:var(--text-12)] tracking-[var(--tracking-md)] text-ink rotate-[-1.5deg] origin-left")}>
          DMs
          <span className="count-chip">{dmCount}</span>
          <button className={PLUS_BTN} title="new dm" aria-label="new dm">+</button>
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
                {...(other ? { profileAgent: other, onViewProfile: setProfileAgent } : {})}
                {...(other?.status ? { otherStatus: other.status } : {})}
              {...(other?.color ? { otherColor: other.color } : {})}
              />
            );
          })}
        </div>
      </section>

      <div className={cn("sidebar-bottom", "flex items-center gap-[var(--space-10)] px-[14px] pt-[12px] pb-[14px] [border-top:var(--line)] bg-paper-2 flex-none")}>
        <button
          type="button"
          className={cn("user-bubble", "relative flex-none w-[40px] min-w-[40px] h-[40px] min-h-[40px] grid place-items-center m-0 bg-paper text-ink [border:var(--line-md)] rounded-pill shadow-sm cursor-pointer [transition:transform_80ms_ease,box-shadow_80ms_ease] hover:translate-x-[-1px] hover:translate-y-[-1px] hover:shadow-hover")}
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
              { divider: true },
              { label: "Sign out", danger: true, onSelect: () => console.log("sign out") },
            ])
          }
        >
          <span className="font-display text-[length:var(--text-14)] tracking-[var(--tracking-xs)] leading-none">{me.avatar}</span>
          <StatusDot status={me.status} size={11} />
          <span className={vimModeChip({ mode })} aria-label={`vim mode: ${mode}`}>
            {mode === "navigate" ? "NAV" : "INS"}
          </span>
        </button>
        <button
          type="button"
          className={cn(activityDockBtn(), activeRoomId === "activity" && "active")}
          data-vim-item="room-activity"
          onClick={() => onSelect("activity")}
          title="Activity - global cross-room feed"
          aria-label={`Activity${awaitingCount > 0 ? `, ${awaitingCount} awaiting you` : ""}`}
        >
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="3 13 8 13 10.5 19 14 6 16 13 21 13" />
          </svg>
          {awaitingCount > 0 && <span className="activity-dock-badge absolute top-[-10px] right-[-10px] min-w-[24px] h-[19px] px-[6px] grid place-items-center bg-pink text-ink [border:var(--line-xs-ink)] rounded-pill shadow-chip font-mono text-[length:var(--text-10)] font-extrabold leading-none">{awaitingCount}</span>}
        </button>
        <button type="button" className="h-[40px] min-w-[84px] px-[12px] bg-yellow text-ink [border:var(--line-md)] rounded-md shadow-sm font-display text-[length:var(--text-10)] tracking-[var(--tracking-md)] cursor-pointer hover:translate-x-[-1px] hover:translate-y-[-1px] hover:shadow-hover" onClick={archive.openConsole} title="Open resume recovery console" aria-label="Open resume recovery console">
          RESUME
        </button>
      </div>
      {spawnRoom && <SpawnAgentDialog room={spawnRoom} onClose={() => setSpawnRoom(null)} />}
      <AgentProfileDialog agent={profileAgent} onClose={() => setProfileAgent(null)} />
    </aside>
  );
}

function RoomItem({
  room,
  active,
  onSelect,
  onSpawnAgent,
  profileAgent,
  onViewProfile,
  otherStatus,
  otherColor,
}: {
  room: Room;
  active: boolean;
  onSelect(id: string): void;
  onSpawnAgent?(room: Room): void;
  profileAgent?: Agent;
  onViewProfile?(agent: Agent): void;
  otherStatus?: import("../data/types.ts").AgentStatus;
  otherColor?: string;
}) {
  const openMenu = useContextMenu();
  const archive = useArchiveWorkflow();
  const toast = useToast();
  const iconColor = otherColor ?? room.color;
  const isArchivedGroup = room.kind === "group" && room.archiveState === "archived";
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    onSelect(room.id);
  };
  return (
    <div
      role="button"
      tabIndex={0}
      className={cn(
        roomItem(),
        active && "active",
        isArchivedGroup && "archived",
      )}
      data-vim-item={`room-${room.id}`}
      onClick={() => onSelect(room.id)}
      onKeyDown={handleKeyDown}
      onContextMenu={(e) => {
        if (room.kind === "dm" && profileAgent) {
          openMenu(e, agentActionMenuItems(e, {
            agent: profileAgent,
            toast,
            archive,
            onOpenDm: () => onSelect(room.id),
            ...(onViewProfile ? { onViewProfile: () => onViewProfile(profileAgent) } : {}),
          }));
          return;
        }
        openMenu(e, [
          ...(room.kind === "group" && onSpawnAgent
            ? [{ label: "Spawn agent...", onSelect: () => onSpawnAgent(room) }]
            : []),
          ...(room.kind === "group" && onSpawnAgent ? [{ divider: true as const }] : []),
          { label: "Mark as read (soon)", disabled: true, onSelect: () => {} },
          { label: `${room.pinned ? "Unpin" : "Pin to top"} (soon)`, disabled: true, onSelect: () => {} },
          { label: "Mute notifications (soon)", disabled: true, onSelect: () => {} },
          { divider: true },
          ...(room.kind === "group"
            ? [
                { label: "Archive group...", onSelect: () => archive.archiveGroup(room) },
                { label: "Resume archived sessions...", disabled: (room.archivedMemberCount ?? 0) === 0, onSelect: () => archive.resumeGroup(room) },
                { divider: true as const },
              ]
            : []),
          { label: "Copy room id", onSelect: () => navigator.clipboard?.writeText(room.id) },
          { divider: true },
          { label: `${room.kind === "group" ? "Leave group" : "Close DM"} (soon)`, danger: true, disabled: true, onSelect: () => {} },
        ]);
      }}
    >
      {isArchivedGroup ? (
        <div className="room-icon identity-icon">
          <span>{room.emoji ?? room.name[0]?.toUpperCase() ?? "#"}</span>
        </div>
      ) : (
        <IdentityBadge as="div" className="room-icon identity-icon" color={iconColor}>
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
        </IdentityBadge>
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-[var(--space-6)]">
          <div className="room-name font-semibold text-[length:var(--text-13-5)] whitespace-nowrap overflow-hidden text-ellipsis">{room.kind === "group" ? `#${room.name}` : room.name}</div>
          {room.pinned && <span className="text-[length:var(--text-9)] opacity-80">📌</span>}
        </div>
        <div className="room-preview text-[length:var(--text-11-5)] text-ink-soft whitespace-nowrap overflow-hidden text-ellipsis">{room.lastPreview}</div>
      </div>
      {room.unread > 0 && <span className="unread bg-pink text-ink [border:var(--line-sm)] rounded-pill min-w-[22px] h-[22px] px-[6px] grid place-items-center font-display text-[length:var(--text-11)] shadow-chip">{room.unread}</span>}
      {isArchivedGroup && (
        <button
          type="button"
          className="room-resume-btn w-[32px] h-[32px] flex-[0_0_auto] grid place-items-center ml-auto bg-yellow text-ink [border:var(--line-md)] rounded-pill shadow-chip cursor-pointer [transition:transform_80ms_ease,box-shadow_80ms_ease] hover:translate-x-[-1px] hover:translate-y-[-1px] hover:shadow-hover"
          aria-label={`Resume #${room.name}`}
          title={`Resume #${room.name}`}
          onClick={(event) => {
            event.stopPropagation();
            archive.resumeGroup(room);
          }}
          onContextMenu={(event) => event.stopPropagation()}
        >
          <span className="w-0 h-0 ml-[2px] border-t-[6px] border-t-transparent border-b-[6px] border-b-transparent border-l-[9px] border-l-[currentColor]" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
