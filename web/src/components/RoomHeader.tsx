import { cn } from "../lib/cn.ts";
import { useAgents, useMe } from "../data/context.tsx";
import type { Room } from "../data/types.ts";
import { Avatar, RoomNameInline } from "./primitives.tsx";
import { TopBar, TopBarTitle, TopBarMeta, TabGroup, type TabGroupItem } from "./TopBar.tsx";
import { roomAgents } from "../data/roomAgents.ts";
import { isSelfAgent } from "../data/identity.ts";
import { useIsCompact } from "../shell-mode.tsx";
import { IconButton } from "./IconButton.tsx";
import { Settings } from "lucide-react";
import type { MouseEvent as ReactMouseEvent } from "react";

export type RoomTab = "chat" | "board" | "artifacts";

const ROOM_TABS: readonly TabGroupItem<RoomTab>[] = [
  { id: "chat", label: "Chat", tooltip: "Room conversation" },
  { id: "board", label: "Board", tooltip: "Room kanban board" },
  { id: "artifacts", label: "Artifacts", tooltip: "Room artifacts" },
];

/**
 * The room flavor of the unified TopBar (Sigil ref `.head`, chat/board views):
 * `# room` title, inline mono meta, the surface TabGroup, and the overlapping
 * member crew (which doubles as the roster-panel trigger). */

interface RoomHeaderProps {
  room: Room;
  tab: RoomTab;
  onTab(t: RoomTab): void;
  onOpenAgents?(): void;
  onOpenSettings?(event: ReactMouseEvent<HTMLButtonElement>): void;
}

export function RoomHeader({ room, tab, onTab, onOpenAgents, onOpenSettings }: RoomHeaderProps) {
  const agents = useAgents();
  const me = useMe();
  const compact = useIsCompact();
  const displayAgents = roomAgents(agents, room);
  // Crew: room members in seed order, operator excluded — the ref cluster
  // shows the working agents, not the human.
  const crew = room.members
    .map((id) => displayAgents.find((a) => a.id === id))
    .filter((a): a is NonNullable<typeof a> => Boolean(a) && !isSelfAgent(a!, me));

  return (
    <TopBar className="room-header">
      <TopBarTitle>
        <RoomNameInline
          kind={room.kind}
          name={room.name}
          className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap"
        />
      </TopBarTitle>
      {!compact && room.description ? <TopBarMeta>{room.description}</TopBarMeta> : null}

      {compact ? (
        // Compact keeps a single thumb-sized settings button; the room surface
        // lives in the bottom nav there.
        <IconButton
          icon={Settings}
          label="open display settings"
          size={40}
          iconSize={19}
          className="ml-auto"
          onClick={(event) => onOpenSettings?.(event)}
        />
      ) : (
        <>
          <TabGroup items={ROOM_TABS} value={tab} onChange={onTab} ariaLabel="room surface" className="ml-auto" />
          {crew.length > 0 && (
            <button
              type="button"
              className={cn("room-crew flex items-center bg-transparent [border:var(--line-none)] p-0 cursor-pointer hover:opacity-80")}
              title="View agents"
              aria-label={`view ${crew.length} agents`}
              onClick={onOpenAgents}
            >
              {/* ref bare-sigstyle crew: transparent, borderless glyphs that
                  float and overlap (-6px), not tile pills. The bare treatment
                  is applied via `.room-crew .sigil-chip` in styles.css. */}
              {crew.map((a, i) => (
                <span key={a.id} className="inline-flex [&+span]:ml-[-6px]" style={{ zIndex: crew.length - i }}>
                  <Avatar agent={a} size={24} />
                </span>
              ))}
            </button>
          )}
        </>
      )}
    </TopBar>
  );
}
