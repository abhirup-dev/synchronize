import { useMemo } from "react";
import { Tooltip } from "@base-ui-components/react/tooltip";
import { useAgents, useRooms, useTimeline } from "../data/context.tsx";
import type { TimelineEvent, TimelineEventType } from "../data/types.ts";
import { roomAgents } from "../data/roomAgents.ts";

interface TimelineRailProps {
  roomId: string;
}

// Pull from the DESIGN.md palette via CSS custom properties so the rail
// recolors automatically when the theme switches to dark.
const TYPE_COLOR: Record<TimelineEventType, string> = {
  kickoff: "var(--yellow)",
  claim:   "var(--blue)",
  analyze: "var(--lilac)",
  review:  "var(--pink)",
  deliver: "var(--lime)",
  ship:    "var(--teal)",
  alert:   "var(--red)",
  request: "var(--tangerine)",
};

const TYPE_GLYPH: Record<TimelineEventType, string> = {
  kickoff: "▶",
  claim:   "✋",
  analyze: "◎",
  review:  "✓",
  deliver: "★",
  ship:    "🚀",
  alert:   "!",
  request: "?",
};

function formatTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
}

export function TimelineRail({ roomId }: TimelineRailProps) {
  const events = useTimeline(roomId);
  const agents = useAgents();
  const rooms = useRooms();
  const room = rooms.find((candidate) => candidate.id === roomId);
  const displayAgents = useMemo(() => room ? roomAgents(agents, room) : agents, [agents, room]);

  const sorted = useMemo(
    () => [...events].sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    [events],
  );

  function scrollToMessage(messageId: string | undefined) {
    if (!messageId) return;
    const el = document.getElementById(`msg-${messageId}`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.add("flash-highlight");
    window.setTimeout(() => el.classList.remove("flash-highlight"), 2400);
  }

  if (sorted.length === 0) {
    return (
      <aside className="timeline-rail empty" aria-label="room timeline">
        <div className="timeline-head">
          <span className="timeline-head-label">TIMELINE</span>
          <span className="timeline-head-count">0</span>
        </div>
        <div className="timeline-empty">no events yet</div>
      </aside>
    );
  }

  return (
    <aside className="timeline-rail" aria-label="room timeline">
      <div className="timeline-head">
        <span className="timeline-head-label">TIMELINE</span>
        <span className="timeline-head-count">{sorted.length}</span>
      </div>
      <Tooltip.Provider>
        <div className="timeline-track">
          {sorted.map((ev, i) => (
            <Node
              key={ev.id}
              ev={ev}
              isFirst={i === 0}
              isLast={i === sorted.length - 1}
              authorName={displayAgents.find((a) => a.id === ev.agentId)?.name ?? ev.agentId}
              authorRole={displayAgents.find((a) => a.id === ev.agentId)?.role ?? ""}
              onClick={() => scrollToMessage(ev.messageId)}
            />
          ))}
        </div>
      </Tooltip.Provider>
    </aside>
  );
}

interface NodeProps {
  ev: TimelineEvent;
  isFirst: boolean;
  isLast: boolean;
  authorName: string;
  authorRole: string;
  onClick(): void;
}

function Node({ ev, isFirst, isLast, authorName, authorRole, onClick }: NodeProps) {
  const bg = TYPE_COLOR[ev.type];
  const glyph = TYPE_GLYPH[ev.type];
  return (
    <Tooltip.Root>
      <Tooltip.Trigger
        delay={0}
        closeDelay={0}
        render={
          <div
            className="timeline-node"
            role="button"
            tabIndex={0}
            onClick={onClick}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick();
              }
            }}
            style={{ cursor: ev.messageId ? "pointer" : "default" }}
          />
        }
      >
        <div
          className="timeline-line-segment top"
          data-edge={isFirst ? "first" : undefined}
        />
        <div className="timeline-marker" style={{ background: bg }} aria-hidden>
          <span className="timeline-marker-glyph">{glyph}</span>
        </div>
        <span className="timeline-time">{formatTime(ev.createdAt)}</span>
        <div
          className="timeline-line-segment bot"
          data-edge={isLast ? "last" : undefined}
        />
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Positioner side="right" align="center" sideOffset={12}>
          <Tooltip.Popup className="timeline-tooltip">
            <TooltipContent ev={ev} authorName={authorName} authorRole={authorRole} />
          </Tooltip.Popup>
        </Tooltip.Positioner>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

function TooltipContent({ ev, authorName, authorRole }: { ev: TimelineEvent; authorName: string; authorRole: string }) {
  const bg = TYPE_COLOR[ev.type];
  return (
    <>
      <div className="tooltip-head">
        <span className="tooltip-type-pill" style={{ background: bg }}>
          {ev.type.toUpperCase()}
        </span>
        <span className="tooltip-time">{formatTime(ev.createdAt)}</span>
      </div>
      <div className="tooltip-actor">
        <span className="tooltip-actor-name">{authorName}</span>
        <span className="tooltip-actor-role">{authorRole}</span>
      </div>
      <div className="tooltip-label">{ev.label}</div>
      {ev.messageId && <div className="tooltip-cta">click to jump to message</div>}
    </>
  );
}
