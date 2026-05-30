// Thread Summary panel — slides in from the left of the chat view. Mirrors the
// chat list's scroll position and places one dot per threaded message at the
// same vertical position as its parent message bubble, with a summary card to
// the left of each dot.
//
// Ported from the Claude Design prototype (thread-summary.jsx). The prototype
// read live DOM positions via querySelector each frame; the production chat is
// virtualized (off-screen rows aren't in the DOM), so we drive dot positions
// from the virtualizer instead — ChatView hands us `getAnchorTop(id)` (a
// message's center offset in chat-content coordinates) and `getContentHeight()`.
//
// Summary prose comes from the `useThreadSummary` seam (bd sync-b8q). Until the
// backend is wired, that returns { status: "disabled" } and we fall back to a
// generated headline.

import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties, PointerEvent } from "react";
import type { Agent, Message } from "../data/types.ts";
import { useThreadSummary } from "../data/context.tsx";
import { Avatar, Sticker } from "./primitives.tsx";
import { Markdown } from "./Markdown.tsx";

interface ThreadSummaryPanelProps {
  messages: Message[];
  agents: Agent[];
  width: number;
  onWidthChange(width: number): void;
  onJumpTo(messageId: string): void;
  /** The chat list's scroll element (for scroll sync). */
  chatListRef: React.RefObject<HTMLDivElement | null>;
  /** A threaded message's vertical center in chat-content coordinates, or null
   *  if it isn't currently in the list. */
  getAnchorTop(messageId: string): number | null;
  /** Total scrollable height of the chat content. */
  getContentHeight(): number;
}

function formatTime(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function ThreadSummaryPanel({
  messages,
  agents,
  width,
  onWidthChange,
  onJumpTo,
  chatListRef,
  getAnchorTop,
  getContentHeight,
}: ThreadSummaryPanelProps) {
  const threadMessages = messages.filter((m) => (m.threadReplyCount ?? 0) > 0);

  const panelScrollRef = useRef<HTMLDivElement | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const rowRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // ── continuous measurement loop ──────────────────────────────────────────
  // Each frame we read each threaded message's live offset (from the
  // virtualizer, via getAnchorTop) and position the corresponding row's dot near
  // the same screen Y as its bubble. A second pass preserves row order and
  // spacing when summaries get taller than the gaps between nearby thread roots.
  useEffect(() => {
    const list = chatListRef.current;
    const panel = panelScrollRef.current;
    const track = trackRef.current;
    if (!list || !panel || !track) return;

    let raf = 0;
    let lastTrackHeight = -1;

    const tick = () => {
      const listRect = list.getBoundingClientRect();
      const panelRect = panel.getBoundingClientRect();
      // If panel chrome ever sits below the chat list's top edge, shift rows up
      // by that gap so each dot still tracks its bubble's screen Y.
      const chromeOffset = Math.max(0, panelRect.top - listRect.top);
      const scrollTop = list.scrollTop;
      const placements: Array<{ rowEl: HTMLDivElement; rowHalf: number; desiredTop: number; top: number }> = [];

      for (const m of threadMessages) {
        const rowEl = rowRefs.current[m.id];
        if (!rowEl) continue;
        const center = getAnchorTop(m.id);
        if (center === null) {
          rowEl.style.display = "none";
          continue;
        }
        const rowHalf = rowEl.offsetHeight / 2;
        const desiredTop = center - chromeOffset;
        rowEl.style.display = "";
        placements.push({ rowEl, rowHalf, desiredTop, top: desiredTop });
      }

      placements.sort((a, b) => a.desiredTop - b.desiredTop);
      let previousBottom = scrollTop + 8;
      for (const placement of placements) {
        const viewportTop = scrollTop + placement.rowHalf + 8;
        const viewportBottom = scrollTop + panel.clientHeight - placement.rowHalf - 8;
        const visibleTop =
          viewportBottom > viewportTop
            ? Math.min(Math.max(placement.desiredTop, viewportTop), viewportBottom)
            : placement.desiredTop;
        placement.top = Math.max(visibleTop, previousBottom + placement.rowHalf + 8);
        previousBottom = placement.top + placement.rowHalf;
      }

      const overflow = previousBottom - (scrollTop + panel.clientHeight - 8);
      if (overflow > 0 && placements.length > 0) {
        const first = placements[0]!;
        const maxShift = Math.max(0, first.top - (scrollTop + first.rowHalf + 8));
        const shift = Math.min(overflow, maxShift);
        for (const placement of placements) placement.top -= shift;
      }

      for (const placement of placements) {
        placement.rowEl.style.top = `${placement.top}px`;
      }

      const trackHeight = getContentHeight();
      if (trackHeight !== lastTrackHeight) {
        track.style.height = `${trackHeight}px`;
        lastTrackHeight = trackHeight;
      }
      // Mirror the chat scroll by translating the track rather than natively
      // scrolling the panel — the panel's viewport is taller than the chat
      // list (no composer beneath it), so equal scrollTop can't stay in sync.
      track.style.transform = `translateY(${-scrollTop}px)`;

      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [threadMessages, chatListRef, getAnchorTop, getContentHeight]);

  // Wheel over the panel scrolls the chat list (which the rAF loop mirrors).
  const onPanelWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    const list = chatListRef.current;
    if (!list) return;
    list.scrollTop += e.deltaY;
  };

  return (
    <aside
      className="thread-summary-panel"
      aria-label="Thread activity"
      style={{ "--thread-summary-width": `${width}px` } as CSSProperties}
    >
      {threadMessages.length === 0 ? (
        <div className="thread-summary-empty">
          <Sticker label="QUIET" color="var(--yellow)" tilt={-2} />
          <p>No threads in this room yet. Reply to any message to start one.</p>
        </div>
      ) : (
        <div className="thread-summary-scroll" ref={panelScrollRef} onWheel={onPanelWheel}>
          <div className="thread-summary-track" ref={trackRef}>
            <span className="thread-summary-axis" />
            {threadMessages.map((m) => (
              <ThreadSummaryRow
                key={m.id}
                msg={m}
                agents={agents}
                rowRef={(el) => {
                  rowRefs.current[m.id] = el;
                }}
                width={width}
                onJump={() => onJumpTo(m.id)}
              />
            ))}
          </div>
        </div>
      )}
      <ThreadSummaryResizeHandle width={width} onChange={onWidthChange} />
    </aside>
  );
}

function clampWidth(value: number, min = 240, max = 620): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function ThreadSummaryResizeHandle({
  width,
  onChange,
}: {
  width: number;
  onChange(width: number): void;
}) {
  const draggingRef = useRef(false);
  const [dragging, setDragging] = useState(false);
  const startRef = useRef({ pointerX: 0, startWidth: 0 });
  const widthRef = useRef(width);
  widthRef.current = width;

  const onPointerDown = useCallback((e: PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    startRef.current = { pointerX: e.clientX, startWidth: widthRef.current };
    draggingRef.current = true;
    setDragging(true);
  }, []);

  const onPointerMove = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      if (!draggingRef.current) return;
      const dx = e.clientX - startRef.current.pointerX;
      onChange(clampWidth(startRef.current.startWidth + dx));
    },
    [onChange],
  );

  const endDrag = useCallback((e: PointerEvent<HTMLDivElement>) => {
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      // ignore; pointer capture may already have been released
    }
    draggingRef.current = false;
    setDragging(false);
  }, []);

  useEffect(() => {
    if (!dragging) return;
    const previousUserSelect = document.body.style.userSelect;
    const previousCursor = document.body.style.cursor;
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
    return () => {
      document.body.style.userSelect = previousUserSelect;
      document.body.style.cursor = previousCursor;
    };
  }, [dragging]);

  return (
    <div
      className={`thread-summary-resize-handle${dragging ? " is-dragging" : ""}`}
      role="separator"
      aria-orientation="vertical"
      aria-label="resize thread activity panel"
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onDoubleClick={() => onChange(340)}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft") onChange(clampWidth(width - 16));
        if (e.key === "ArrowRight") onChange(clampWidth(width + 16));
      }}
    >
      <span className="thread-summary-resize-grip" aria-hidden />
    </div>
  );
}

function ThreadSummaryRow({
  msg,
  agents,
  rowRef,
  width,
  onJump,
}: {
  msg: Message;
  agents: Agent[];
  rowRef: (el: HTMLDivElement | null) => void;
  width: number;
  onJump(): void;
}) {
  const summary = useThreadSummary(msg.id);
  const author = agents.find((a) => a.id === msg.authorId);
  const dotColor = author?.color ?? "var(--yellow)";

  // Participants = the author plus any recorded thread participants, de-duped.
  const participantIds = [msg.authorId, ...(msg.threadParticipantIds ?? [])].filter(
    (id, i, arr) => arr.indexOf(id) === i,
  );
  const participants = participantIds
    .map((id) => agents.find((a) => a.id === id))
    .filter((a): a is Agent => Boolean(a));

  const replyCount = msg.threadReplyCount ?? 0;
  const fallback =
    `${replyCount} ${replyCount === 1 ? "reply" : "replies"} from ` +
    `${participantIds.length} ${participantIds.length === 1 ? "agent" : "agents"}.`;
  const summaryText = summary.status === "ok" && summary.text ? summary.text : fallback;
  const summaryLines = summaryLineCount(msg.body, width);
  const summaryRef = useRef<HTMLDivElement | null>(null);
  const [summaryTruncated, setSummaryTruncated] = useState(false);

  useEffect(() => {
    let frame = 0;
    const update = () => {
      const el = summaryRef.current;
      if (!el) return;
      const truncated = el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1;
      setSummaryTruncated((current) => (current === truncated ? current : truncated));
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(update);
    };

    schedule();
    const observer =
      typeof ResizeObserver === "undefined" || !summaryRef.current ? null : new ResizeObserver(schedule);
    if (summaryRef.current) observer?.observe(summaryRef.current);
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
    };
  }, [summaryText, summaryLines, width]);

  return (
    <div
      ref={rowRef}
      className="ts-row"
      style={
        {
          top: "0px", // overridden by the rAF loop
          "--ts-summary-lines": summaryLines,
        } as CSSProperties
      }
      onClick={onJump}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onJump();
        }
      }}
    >
      <div className="ts-body">
        <div className="ts-meta">
          <span className="ts-author" style={{ color: dotColor }}>
            {author?.name ?? "?"}
          </span>
          <span className="ts-meta-sep">·</span>
          <span className="ts-time">{formatTime(msg.createdAt)}</span>
          <span className="ts-meta-sep">·</span>
          <span className="ts-replies">
            {replyCount} {replyCount === 1 ? "reply" : "replies"}
          </span>
        </div>
        <div
          ref={summaryRef}
          className={`ts-summary${summaryTruncated ? " is-truncated" : ""}`}
          title={summaryTruncated ? summaryText : undefined}
        >
          <Markdown agents={agents}>{summaryText}</Markdown>
        </div>
        <div className="ts-foot">
          <span className="ts-avatars">
            {participants.slice(0, 5).map((p) => (
              <Avatar key={p.id} agent={p} size={18} />
            ))}
            {participants.length > 5 ? (
              <span className="ts-avatars-more">+{participants.length - 5}</span>
            ) : null}
          </span>
          {msg.threadLastReplyAt ? (
            <span className="ts-last">last reply {formatTime(msg.threadLastReplyAt)}</span>
          ) : null}
        </div>
      </div>
      <span className="ts-connector" />
      <span className="ts-dot" style={{ background: dotColor }} aria-hidden="true" />
    </div>
  );
}

function summaryLineCount(rootBody: string, width: number): number {
  const rootLength = rootBody.trim().length;
  const rootWeight = rootLength < 90 ? 1 : rootLength < 180 ? 2 : rootLength < 320 ? 3 : rootLength < 520 ? 4 : 5;
  const widthBonus = width >= 560 ? 3 : width >= 460 ? 2 : width >= 340 ? 1 : 0;
  return Math.max(1, Math.min(8, rootWeight + widthBonus));
}
