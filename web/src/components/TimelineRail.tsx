import { useMemo, useState } from "react";
import { useAgents, useTimeline } from "../data/context.tsx";
import type { TimelineEvent, TimelineEventType } from "../data/types.ts";

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

interface HoverState {
  ev: TimelineEvent;
  x: number;
  y: number;
}

export function TimelineRail({ roomId }: TimelineRailProps) {
  const events = useTimeline(roomId);
  const agents = useAgents();
  const [hover, setHover] = useState<HoverState | null>(null);

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
      <div className="timeline-track">
        {sorted.map((ev, i) => (
          <Node
            key={ev.id}
            ev={ev}
            isFirst={i === 0}
            isLast={i === sorted.length - 1}
            onHover={(rect) => {
              if (rect) setHover({ ev, x: rect.right + 12, y: rect.top + rect.height / 2 });
              else setHover((s) => (s?.ev.id === ev.id ? null : s));
            }}
            onClick={() => scrollToMessage(ev.messageId)}
          />
        ))}
      </div>
      {hover && (
        <div
          className="timeline-tooltip"
          style={{
            position: "fixed",
            left: hover.x,
            top: hover.y,
            transform: "translateY(-50%)",
          }}
        >
          <Tooltip ev={hover.ev} authorName={agents.find((a) => a.id === hover.ev.agentId)?.name ?? hover.ev.agentId} authorRole={agents.find((a) => a.id === hover.ev.agentId)?.role ?? ""} />
        </div>
      )}
    </aside>
  );
}

interface NodeProps {
  ev: TimelineEvent;
  isFirst: boolean;
  isLast: boolean;
  onHover(rect: DOMRect | null): void;
  onClick(): void;
}

function Node({ ev, isFirst, isLast, onHover, onClick }: NodeProps) {
  const bg = TYPE_COLOR[ev.type];
  const glyph = TYPE_GLYPH[ev.type];
  return (
    <div
      className="timeline-node"
      role="button"
      tabIndex={0}
      onMouseEnter={(e) => onHover((e.currentTarget as HTMLElement).getBoundingClientRect())}
      onMouseLeave={() => onHover(null)}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      style={{ cursor: ev.messageId ? "pointer" : "default" }}
    >
      <div
        className="timeline-line-segment top"
        data-edge={isFirst ? "first" : undefined}
      />
      <div className="timeline-marker" style={{ background: bg }} aria-hidden>
        <span style={{ fontSize: 13, lineHeight: 1, color: "var(--ink)" }}>{glyph}</span>
      </div>
      <span className="timeline-time">{formatTime(ev.createdAt)}</span>
      <div
        className="timeline-line-segment bot"
        data-edge={isLast ? "last" : undefined}
      />
    </div>
  );
}

function Tooltip({ ev, authorName, authorRole }: { ev: TimelineEvent; authorName: string; authorRole: string }) {
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
