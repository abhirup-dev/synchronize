import { useMemo } from "react";
import { Tooltip } from "@base-ui-components/react/tooltip";
import { cva } from "class-variance-authority";
import { cn } from "../lib/cn.ts";
import { useAgents, useRooms, useTimeline } from "../data/context.tsx";
import type { TimelineEvent, TimelineEventType } from "../data/types.ts";
import { roomAgents } from "../data/roomAgents.ts";

/**
 * Timeline rail styling migrated off styles.css to inline Tailwind utilities
 * (tokens bridged via tw.css `@theme inline`). The old `.timeline-rail:hover
 * .child` parent-hover rules are reproduced with a `group` marker on the rail
 * (kept as `timeline-rail` hook) + `group-hover:` on descendants. Hooks kept on
 * elements: `timeline-rail` (styles.css `.shell-compact`/responsive/`:has`
 * collapse + extra.css overflow), `timeline-track` (extra.css overflow-x),
 * `timeline-tooltip` (skin-glass backdrop). The `.timeline-tooltip::after` arrow
 * (pseudo-element), `tooltip-in` keyframes, and `flash-highlight` (added
 * dynamically by scrollToMessage / used by App + ChatView) stay in styles.css /
 * extra.css. Node marker `background` and node `cursor` remain dynamic inline
 * styles. Legacy `.timeline-node.hovered/.focused/.dimmed`, legend, and
 * empty-label/sub rules were never emitted by this component.
 */
const railBase = "timeline-rail group relative flex min-h-0 flex-col bg-transparent opacity-50 [border-right:var(--line-dashed-faint)] [transition:opacity_180ms_ease,background_200ms_ease] hover:bg-paper hover:opacity-100";
const lineSegment = cva(
  "w-[2px] ml-[14px] h-[14px] shrink-0 bg-ink-faint group-hover:bg-ink-soft",
  {
    variants: { edge: { true: "data-[edge]:bg-transparent", false: null } },
    defaultVariants: { edge: false },
  },
);
const tooltipPill = "font-display text-[length:var(--text-9-5)] tracking-[var(--tracking-md)] px-[7px] py-[2px] text-on-accent [border:var(--line-sm)] rounded-xs shadow-chip";
const dashedTopNote = "[border-top:var(--line-dashed-faint)]";

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
      <aside className={cn(railBase, "opacity-40")} aria-label="room timeline">
        <div className="flex items-center justify-between pt-[18px] pr-[10px] pb-[10px] pl-[14px] [border-bottom:var(--line-dashed-faint)]">
          <span className="font-display text-[length:var(--text-10)] tracking-[var(--tracking-lg)] text-ink-soft group-hover:text-ink">TIMELINE</span>
          <span className="font-mono text-[length:var(--text-10)] font-bold text-ink-soft bg-paper-2 px-[6px] [border:var(--line-xs-faint)] rounded-xs group-hover:text-ink group-hover:[border-color:var(--rule)]">0</span>
        </div>
        <div className="flex flex-1 flex-col items-center justify-center gap-[var(--space-6)] px-[8px] py-[30px] text-center">no events yet</div>
      </aside>
    );
  }

  return (
    <aside className={railBase} aria-label="room timeline">
      <div className="flex items-center justify-between pt-[18px] pr-[10px] pb-[10px] pl-[14px] [border-bottom:var(--line-dashed-faint)]">
        <span className="font-display text-[length:var(--text-10)] tracking-[var(--tracking-lg)] text-ink-soft group-hover:text-ink">TIMELINE</span>
        <span className="font-mono text-[length:var(--text-10)] font-bold text-ink-soft bg-paper-2 px-[6px] [border:var(--line-xs-faint)] rounded-xs group-hover:text-ink group-hover:[border-color:var(--rule)]">{sorted.length}</span>
      </div>
      <Tooltip.Provider>
        <div className="timeline-track flex flex-1 flex-col items-start overflow-y-auto pt-[6px] pr-0 pb-[14px] pl-[14px]">
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
            className="timeline-node group/node relative flex w-full shrink-0 cursor-pointer flex-col items-start p-0"
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
          className={cn(lineSegment({ edge: isFirst }))}
          data-edge={isFirst ? "first" : undefined}
        />
        <div
          className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-lg text-on-accent shadow-chip [border:var(--line-md)] [transition:transform_120ms_ease,box-shadow_120ms_ease] group-hover/node:z-[var(--z-local-hover)] group-hover/node:-translate-x-px group-hover/node:-translate-y-px group-hover/node:scale-110 group-hover/node:shadow-hover"
          style={{ background: bg }}
          aria-hidden
        >
          <span className="text-ink text-[length:var(--text-13)] leading-none">{glyph}</span>
        </div>
        <span className="pointer-events-none absolute left-[42px] top-[14px] flex h-[30px] items-center whitespace-nowrap font-mono text-[length:var(--text-10)] font-semibold text-ink-faint group-hover:text-ink-soft group-hover/node:font-bold group-hover/node:text-ink">{formatTime(ev.createdAt)}</span>
        <div
          className={cn(lineSegment({ edge: isLast }))}
          data-edge={isLast ? "last" : undefined}
        />
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Positioner side="right" align="center" sideOffset={12}>
          <Tooltip.Popup className="timeline-tooltip pointer-events-none relative w-[260px] bg-paper px-[12px] py-[10px] [border:var(--line-md)] rounded-xl shadow-[var(--shadow)] z-[var(--z-floating-control)] opacity-100 animate-[tooltip-in_140ms_ease]">
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
      <div className="mb-[7px] flex items-center gap-[var(--space-8)]">
        <span className={tooltipPill} style={{ background: bg }}>
          {ev.type.toUpperCase()}
        </span>
        <span className="ml-auto font-mono text-[length:var(--text-10-5)] text-ink-soft">{formatTime(ev.createdAt)}</span>
      </div>
      <div className="mb-[7px] flex items-center gap-[var(--space-7)]">
        <span className="font-bold text-[length:var(--text-12-5)] text-ink">{authorName}</span>
        <span className="font-mono text-[length:var(--text-10-5)] text-ink-soft">{authorRole}</span>
      </div>
      <div className={cn("text-[length:var(--text-12-5)] leading-[1.4] text-ink [text-wrap:pretty] pt-[var(--space-7)]", dashedTopNote)}>{ev.label}</div>
      {ev.messageId && <div className={cn("mt-[7px] pt-[var(--space-7)] font-mono text-[length:var(--text-10)] text-ink-soft", dashedTopNote)}>click to jump to message</div>}
    </>
  );
}
