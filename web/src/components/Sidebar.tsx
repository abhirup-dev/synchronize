import { useState, type KeyboardEvent } from "react";
import { cva } from "class-variance-authority";
import { cn } from "../lib/cn.ts";
import { useMe, useRooms, useAgents, useActivityAwaitingCount } from "../data/context.tsx";
import { RoomNameInline, StatusDot, roomNameText } from "./primitives.tsx";
import { Avatar } from "./primitives.tsx";
import type { Agent, Room } from "../data/types.ts";
import type { RoomTab } from "./RoomHeader.tsx";
import { useContextMenu } from "./ContextMenu.tsx";
import { useAutoScrollbar } from "../hooks/useAutoScrollbar.ts";
import { SpawnAgentDialog } from "./SpawnAgentDialog.tsx";
import { useArchiveWorkflow } from "./ArchiveRecovery.tsx";
import { AgentProfileDialog } from "./AgentPreview.tsx";
import { useToast } from "./Toast.tsx";
import { agentActionMenuItems } from "./agentActionMenu.ts";
import { ALL_THEMES, themeFamily, type ThemeName } from "../hooks/usePersistentTheme.ts";
import { isSelfAgent } from "../data/identity.ts";

/**
 * Sigil reference sidebar (ds-bundle templates/aesthetic-rerun-r3 `.side`):
 * wordmark mast, top-level nav (Rooms / Activity / Board / Artifacts), plain
 * `GROUPS · n` labels, hash room rows with accent unread counts, an AGENTS
 * roster, and a mono operator footer. Features the reference design has no
 * chrome for (DM open, profile, themes, resume console) stay reachable via
 * context menus on the roster rows and the footer.
 *
 * Tokens flow from the styles.css contract via the tw.css `@theme inline`
 * bridge. Skin-hook classes (`sidebar`, `sidebar-brand`, `section-head`,
 * `room-item`+states, `side-nav-item`, `agent-row`) are retained for the
 * [data-theme] override rules in styles.css. */

// Top-level nav row. `.side-nav-item` is the skin hook; active state carries
// the inset accent bar like `.room-item.active`.
const sideNavItem = cva(
  [
    "side-nav-item flex items-center w-full text-left bg-transparent [border:var(--line-none)] rounded-none",
    "px-[20px] py-[8px] cursor-pointer text-[length:var(--text-13)] font-semibold text-ink-soft",
    "hover:bg-paper-3 hover:text-ink",
  ],
  {
    variants: {
      active: {
        true: "text-ink bg-paper-3 [box-shadow:inset_2.5px_0_0_var(--accent)]",
        false: "",
      },
    },
    defaultVariants: { active: false },
  },
);

// Room row. Keeps the `room-item` hook so the Sigil composition CSS + useVimNav's
// `.active` lookup + the .active/.archived/[data-theme] state rules still bind.
const roomItem = cva([
  "room-item flex items-baseline gap-[7px] px-[20px] py-[7px] bg-transparent",
  "[border:var(--line-none)] rounded-none text-left text-ink-soft relative cursor-pointer",
  "text-[length:var(--text-13)] font-semibold hover:bg-paper-3 hover:text-ink",
]);

interface SidebarProps {
  activeRoomId: string;
  onSelect(id: string): void;
  /** Room surface tab, lifted from App so the nav's Board/Artifacts entries
   *  drive the same state as the room-header tabs. */
  tab?: RoomTab;
  onTab?(t: RoomTab): void;
  displaySettings?: {
    theme: ThemeName;
    onTheme(theme: ThemeName): void;
  };
}

function themeLabel(theme: ThemeName): string {
  return themeFamily(theme) === "light" ? "Light" : "Dark";
}

function agentRuntimeLine(agent: Agent): string {
  const tool = agent.runtimeDetails?.tool;
  const model = agent.runtimeDetails?.model;
  if (tool && model) return `${tool} · ${model}`;
  return tool ?? model ?? `@${agent.handle}`;
}

export function Sidebar({ activeRoomId, onSelect, tab = "chat", onTab, displaySettings }: SidebarProps) {
  const rooms = useRooms();
  const me = useMe();
  // The roster lists real agents only — the operator lives in the footer.
  const agents = useAgents().filter((a) => !isSelfAgent(a, me));

  const groups = rooms.filter((r) => r.kind === "group");
  const scrollRef = useAutoScrollbar<HTMLDivElement>();
  const openMenu = useContextMenu();
  const [spawnRoom, setSpawnRoom] = useState<Room | null>(null);
  const [profileAgent, setProfileAgent] = useState<Agent | null>(null);
  const awaitingCount = useActivityAwaitingCount();
  const archive = useArchiveWorkflow();
  const toast = useToast();

  const isActivity = activeRoomId === "activity";
  const activeGroup = groups.find((r) => r.id === activeRoomId);
  const fallbackGroup = activeGroup ?? groups[0];
  const working = agents.filter((a) => a.status === "busy").length;

  // Nav entries route to real app state: Rooms/Board/Artifacts drive the room
  // surface tab (selecting a group room first if Activity was open); Activity
  // is the global feed pseudo-room.
  const goSurface = (t: RoomTab) => {
    if (isActivity && fallbackGroup) onSelect(fallbackGroup.id);
    onTab?.(t);
  };

  return (
    <aside
      className={cn("sidebar", "flex flex-col overflow-hidden relative bg-paper-2")}
      data-vim-panel="sidebar"
    >
      <div className="sidebar-brand flex items-center gap-[8px] px-[20px] pt-[19px] pb-[13px]">
        <span className="font-display">SYNCHRONIZE</span>
        <span className="font-mono text-[length:var(--text-9)] tracking-[0.1em] text-ink-faint">SIGIL</span>
      </div>

      <nav className="sidebar-nav py-[6px]" aria-label="views">
        <button type="button" className={cn(sideNavItem({ active: !isActivity && tab === "chat" }))} onClick={() => goSurface("chat")}>
          Rooms
        </button>
        <button
          type="button"
          className={cn(sideNavItem({ active: isActivity }))}
          data-vim-item="room-activity"
          onClick={() => onSelect("activity")}
          aria-label={`Activity${awaitingCount > 0 ? `, ${awaitingCount} awaiting you` : ""}`}
        >
          Activity
          {awaitingCount > 0 && <span className="ml-auto font-mono text-[length:var(--text-10)] text-[color:var(--accent)]">{awaitingCount}</span>}
        </button>
        <button type="button" className={cn(sideNavItem({ active: !isActivity && tab === "board" }))} onClick={() => goSurface("board")}>
          Board
        </button>
        <button type="button" className={cn(sideNavItem({ active: !isActivity && tab === "artifacts" }))} onClick={() => goSurface("artifacts")}>
          Artifacts
        </button>
      </nav>

      <div className="min-h-0 flex-1 overflow-y-auto autoscroll" ref={scrollRef}>
        <div className="section-head px-[20px] pt-[15px] pb-[6px]">GROUPS · {groups.length}</div>
        {groups.map((r) => (
          <RoomItem key={r.id} room={r} active={!isActivity && r.id === activeRoomId} onSelect={onSelect} onSpawnAgent={setSpawnRoom} />
        ))}

        <div className="section-head flex items-center px-[20px] pt-[15px] pb-[6px]">
          <span>AGENTS · {agents.length}</span>
          {fallbackGroup && (
            <button
              type="button"
              className="ml-auto bg-transparent [border:var(--line-none)] p-0 text-ink-faint cursor-pointer text-[length:var(--text-12)] leading-none hover:text-ink"
              title="Spawn agent"
              aria-label="Spawn agent"
              onClick={() => setSpawnRoom(fallbackGroup)}
            >
              +
            </button>
          )}
        </div>
        {agents.map((a) => (
          <AgentRow key={a.id} agent={a} onViewProfile={setProfileAgent} onOpenDm={onSelect} />
        ))}
      </div>

      <button
        type="button"
        className={cn(
          "sidebar-foot mt-auto flex-none w-full text-left bg-transparent [border:var(--line-none)] [border-top:var(--line)] rounded-none",
          "px-[20px] pt-[13px] pb-[13px] font-mono text-[length:var(--text-9-5)] text-ink-faint leading-[1.9] cursor-pointer",
        )}
        aria-label="operator status and settings"
        onClick={(event) =>
          openMenu(event, [
            { label: `Signed in as ${me.name}`, onSelect: () => console.log("profile", me.id) },
            { divider: true },
            ...(displaySettings
              ? [
                  ...ALL_THEMES.map((theme) => ({
                    label: `Theme: ${themeLabel(theme)}`,
                    ...(theme === displaySettings.theme ? { shortcut: "✓" } : {}),
                    onSelect: () => displaySettings.onTheme(theme),
                  })),
                  { divider: true as const },
                ]
              : []),
            { label: "Resume recovery console...", onSelect: archive.openConsole },
            { divider: true },
            { label: "Copy @handle", onSelect: () => navigator.clipboard?.writeText(`@${me.handle}`) },
            { divider: true },
            { label: "Sign out", danger: true, onSelect: () => console.log("sign out") },
          ])
        }
      >
        <b className="text-ink-soft font-medium">{me.name.toUpperCase()}</b> · {me.role.toUpperCase()}
        <br />
        {working} WORKING · {awaitingCount} AWAITING YOU
      </button>

      {spawnRoom && <SpawnAgentDialog room={spawnRoom} onClose={() => setSpawnRoom(null)} />}
      <AgentProfileDialog agent={profileAgent} onClose={() => setProfileAgent(null)} />
    </aside>
  );
}

// Roster row (ref `.agrow`): avatar, name over runtime line, status dot. Click
// opens the profile dialog; the context menu carries the full agent action set
// (Open DM replaces the old DMs section as the DM entry point).
function AgentRow({
  agent,
  onViewProfile,
  onOpenDm,
}: {
  agent: Agent;
  onViewProfile(agent: Agent): void;
  onOpenDm(roomId: string): void;
}) {
  const rooms = useRooms();
  const openMenu = useContextMenu();
  const archive = useArchiveWorkflow();
  const toast = useToast();
  const dm = rooms.find((r) => r.kind === "dm" && r.peerId === agent.id);
  return (
    <button
      type="button"
      className={cn(
        "agent-row flex items-center gap-[10px] w-full text-left bg-transparent [border:var(--line-none)] rounded-none",
        "px-[20px] py-[6.5px] cursor-pointer hover:bg-paper-3",
        agent.lifecycleState === "archived" && "opacity-45",
      )}
      data-vim-item={`agent-${agent.id}`}
      onClick={() => onViewProfile(agent)}
      onContextMenu={(e) =>
        openMenu(e, agentActionMenuItems(e, {
          agent,
          toast,
          archive,
          ...(dm ? { onOpenDm: () => onOpenDm(dm.id) } : {}),
          onViewProfile: () => onViewProfile(agent),
        }))
      }
    >
      <Avatar agent={agent} size={26} />
      <span className="flex flex-col min-w-0">
        <span className="text-[length:var(--text-13)] font-semibold text-ink whitespace-nowrap overflow-hidden text-ellipsis">{agent.name}</span>
        <span className="font-mono text-[length:var(--text-8-5)] text-ink-faint tracking-[0.06em] uppercase mt-[1px] whitespace-nowrap overflow-hidden text-ellipsis">
          {agentRuntimeLine(agent)}
        </span>
      </span>
      <StatusDot status={agent.status} size={7} className="ml-auto" />
    </button>
  );
}

function RoomItem({
  room,
  active,
  onSelect,
  onSpawnAgent,
}: {
  room: Room;
  active: boolean;
  onSelect(id: string): void;
  onSpawnAgent?(room: Room): void;
}) {
  const openMenu = useContextMenu();
  const archive = useArchiveWorkflow();
  const isArchivedGroup = room.kind === "group" && room.archiveState === "archived";
  const roomLabel = roomNameText(room.kind, room.name);
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
      <RoomNameInline kind={room.kind} name={room.name} className="room-name whitespace-nowrap overflow-hidden text-ellipsis" />
      {room.unread > 0 && <span className="unread ml-auto font-mono text-[length:var(--text-10)] text-[color:var(--accent)]">{room.unread}</span>}
      {isArchivedGroup && (
        <button
          type="button"
          className="room-resume-btn ml-auto flex-none bg-transparent [border:var(--line-none)] p-0 text-ink-faint cursor-pointer text-[length:var(--text-11)] hover:text-ink"
          aria-label={`Resume ${roomLabel}`}
          title={`Resume ${roomLabel}`}
          onClick={(event) => {
            event.stopPropagation();
            archive.resumeGroup(room);
          }}
          onContextMenu={(event) => event.stopPropagation()}
        >
          ▶
        </button>
      )}
    </div>
  );
}
