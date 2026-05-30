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

import { useEffect, useRef } from "react";
import type { Agent, Message } from "../data/types.ts";
import { useThreadSummary } from "../data/context.tsx";
import { Avatar, Sticker } from "./primitives.tsx";
import { Markdown } from "./Markdown.tsx";

interface ThreadSummaryPanelProps {
  messages: Message[];
  agents: Agent[];
  onClose(): void;
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
  onClose,
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
  // virtualizer, via getAnchorTop) and position the corresponding row's dot at
  // the same screen Y as its bubble. chromeOffset accounts for the panel head
  // sitting lower than the chat list's top edge.
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
      // The panel head sits below the chat list's top edge; shift rows up by
      // that gap so each dot lands at its bubble's screen Y.
      const chromeOffset = Math.max(0, panelRect.top - listRect.top);
      const scrollTop = list.scrollTop;

      for (const m of threadMessages) {
        const rowEl = rowRefs.current[m.id];
        if (!rowEl) continue;
        const center = getAnchorTop(m.id);
        if (center === null) {
          rowEl.style.display = "none";
          continue;
        }
        rowEl.style.display = "";
        rowEl.style.top = `${center - chromeOffset}px`;
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
    <aside className="thread-summary-panel">
      <div className="thread-summary-head">
        <div className="thread-summary-title">
          <Sticker label="THREAD ACTIVITY" color="var(--lilac)" tilt={-2} />
          <span className="thread-summary-count">
            {threadMessages.length} {threadMessages.length === 1 ? "thread" : "threads"}
          </span>
        </div>
        <button className="thread-summary-close" onClick={onClose} title="Hide threads" type="button">
          ✕
        </button>
      </div>

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
                onJump={() => onJumpTo(m.id)}
              />
            ))}
          </div>
        </div>
      )}
    </aside>
  );
}

function ThreadSummaryRow({
  msg,
  agents,
  rowRef,
  onJump,
}: {
  msg: Message;
  agents: Agent[];
  rowRef: (el: HTMLDivElement | null) => void;
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

  return (
    <div
      ref={rowRef}
      className="ts-row"
      style={{ top: "0px" }} // overridden by the rAF loop
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
        <div className="ts-summary">
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
