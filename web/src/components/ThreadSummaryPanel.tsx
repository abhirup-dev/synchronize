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
import { Avatar, IdentityBadge, IdentityText, Sticker } from "./primitives.tsx";
import { Markdown } from "./Markdown.tsx";
import { computeThreadSummaryLayout, normalizeWheelDelta } from "./threadSummaryLayout.ts";
import { cn } from "../lib/cn.ts";

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

      for (const placement of computeThreadSummaryLayout(placements)) {
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
    e.preventDefault();
    const delta = normalizeWheelDelta(e.deltaY, e.deltaMode, e.currentTarget.clientHeight);
    list.scrollBy({ top: delta, left: 0, behavior: "auto" });
  };

  return (
    <aside
      className={cn(
        "relative flex min-h-0 flex-col bg-paper [border-right:var(--line)]",
        "w-[var(--thread-summary-width,340px)] flex-[0_0_var(--thread-summary-width,340px)]",
        "min-w-[min(240px,45vw)] max-w-[min(620px,70vw)] [container-type:inline-size]",
        "animate-[thread-summary-slide-in_200ms_cubic-bezier(0.2,0.8,0.2,1)]",
      )}
      aria-label="Thread activity"
      style={{ "--thread-summary-width": `${width}px` } as CSSProperties}
    >
      {threadMessages.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-[12px] [padding:40px_24px] text-center text-ink-soft">
          <Sticker label="QUIET" color="var(--yellow)" tilt={-2} />
          <p className="m-0 max-w-[28ch] font-ui text-[length:var(--text-13)]">No threads in this room yet. Reply to any message to start one.</p>
        </div>
      ) : (
        <div className="relative flex-1 overflow-hidden" ref={panelScrollRef} onWheel={onPanelWheel}>
          <div className="relative w-full [will-change:transform]" ref={trackRef}>
            <span className="absolute right-[18px] top-0 bottom-0 w-[2px] opacity-55 [background:repeating-linear-gradient(to_bottom,var(--ink)_0_6px,transparent_6px_12px)]" />
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
      className={cn(
        "group absolute top-0 right-[-6px] bottom-0 z-[var(--z-local-control)] flex w-[12px] items-center justify-center",
        "cursor-col-resize select-none [touch-action:none] focus-visible:outline-none",
        dragging && "is-dragging",
      )}
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
      <span
        className={cn(
          "h-[42px] w-[2px] rounded-pill opacity-85 [background:color-mix(in_srgb,var(--ink)_32%,transparent)]",
          "[transition:background_120ms_ease,height_120ms_ease,opacity_120ms_ease]",
          "group-hover:h-[64px] group-hover:bg-rule group-hover:opacity-100",
          "group-focus-visible:h-[64px] group-focus-visible:bg-rule group-focus-visible:opacity-100",
          "group-[.is-dragging]:h-[64px] group-[.is-dragging]:bg-rule group-[.is-dragging]:opacity-100",
        )}
        aria-hidden
      />
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
      className="group/ts-row absolute left-0 right-0 flex min-w-0 -translate-y-1/2 cursor-pointer items-center gap-0 outline-none"
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
      <div className="box-border flex w-[calc(100%-38px)] max-w-[calc(100%-38px)] flex-1 flex-col items-end gap-[6px] text-right [padding:6px_14px_6px_18px] @max-[290px]:[padding-left:10px] @max-[290px]:[padding-right:10px] group-focus-visible/ts-row:[outline:2px_solid_var(--blue)] group-focus-visible/ts-row:[outline-offset:4px]">
        <div className="inline-flex max-w-full flex-wrap items-baseline justify-end gap-[6px] @max-[290px]:gap-[4px] font-mono text-[length:var(--text-10-5)] tracking-[var(--tracking-xs)] text-ink-faint">
          <IdentityText className="font-display text-[length:var(--text-11)] uppercase tracking-[var(--tracking-sm)]" color={dotColor}>
            {author?.name ?? "?"}
          </IdentityText>
          <span className="text-ink-faint">·</span>
          <span className="text-ink-soft">{formatTime(msg.createdAt)}</span>
          <span className="text-ink-faint">·</span>
          <span className="text-ink-soft">
            {replyCount} {replyCount === 1 ? "reply" : "replies"}
          </span>
        </div>
        <div
          ref={summaryRef}
          className={cn(
            "ts-summary relative box-border w-[min(38ch,100%)] overflow-hidden font-ui text-[length:var(--text-11-5)] text-ink [line-height:1.32] [text-wrap:pretty] [overflow-wrap:anywhere] [word-break:normal]",
            "[display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:var(--ts-summary-lines,3)]",
            summaryTruncated && "is-truncated [padding-right:1.4ch]",
          )}
          title={summaryTruncated ? summaryText : undefined}
        >
          <Markdown agents={agents}>{summaryText}</Markdown>
        </div>
        <div className="mt-[2px] inline-flex max-w-full flex-wrap items-center justify-end gap-[10px] @max-[290px]:gap-[6px] font-mono text-[length:var(--text-10-5)] text-ink-faint">
          <span className="ts-avatars inline-flex flex-shrink-0 items-center">
            {participants.slice(0, 5).map((p) => (
              <Avatar key={p.id} agent={p} size={18} />
            ))}
            {participants.length > 5 ? (
              <span className="ml-[4px] text-[length:var(--text-10)] text-ink-soft">+{participants.length - 5}</span>
            ) : null}
          </span>
          {msg.threadLastReplyAt ? (
            <span className="whitespace-nowrap text-ink-faint">last reply {formatTime(msg.threadLastReplyAt)}</span>
          ) : null}
        </div>
      </div>
      <span className="h-[2px] w-[12px] flex-shrink-0 self-center bg-ink opacity-65" />
      <IdentityBadge
        className="relative z-[1] h-[14px] w-[14px] flex-shrink-0 rounded-full [border:var(--line-md)] shadow-sm [margin-right:11px]"
        color={dotColor}
      />
    </div>
  );
}

function summaryLineCount(rootBody: string, width: number): number {
  const rootLength = rootBody.trim().length;
  const rootWeight = rootLength < 90 ? 1 : rootLength < 180 ? 2 : rootLength < 320 ? 3 : rootLength < 520 ? 4 : 5;
  const widthBonus = width >= 560 ? 3 : width >= 460 ? 2 : width >= 340 ? 1 : 0;
  return Math.max(1, Math.min(8, rootWeight + widthBonus));
}
