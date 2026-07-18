import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer, type VirtualItem, type Virtualizer } from "@tanstack/react-virtual";
import { cn } from "../lib/cn.ts";
import type { Room } from "../data/types.ts";
import { useAgents, useMe, useMessages, useReactToMessage } from "../data/context.tsx";
import { MessageRow } from "./MessageRow.tsx";
import { Composer } from "./Composer.tsx";
import { useAutoScrollbar } from "../hooks/useAutoScrollbar.ts";
import { ScrollControls } from "./ScrollControls.tsx";
import { ThreadSummaryPanel } from "./ThreadSummaryPanel.tsx";
import { roomAgents } from "../data/roomAgents.ts";
import { useShellMode } from "../shell-mode.tsx";

const THREAD_SUMMARY_DEFAULT_WIDTH = 340;
const THREAD_SUMMARY_MIN_WIDTH = 240;
const THREAD_SUMMARY_MAX_WIDTH = 620;

type ResizeAdjustmentVirtualizer = Virtualizer<HTMLDivElement, Element> & {
  shouldAdjustScrollPositionOnItemSizeChange?: (
    item: VirtualItem,
    delta: number,
    instance: Virtualizer<HTMLDivElement, Element>,
  ) => boolean;
};

export function ChatView({
  room,
  onOpenThread,
  onOpenDm,
  isThreadOpen = false,
  threadSummaryOpen = false,
  onToggleThreadSummary,
  focusMessageId,
  onFocusedMessage,
}: {
  room: Room;
  onOpenThread?(parentId: string): void;
  onOpenDm?(agentId: string): void;
  isThreadOpen?: boolean;
  threadSummaryOpen?: boolean;
  onToggleThreadSummary?(): void;
  focusMessageId?: string;
  onFocusedMessage?(): void;
}) {
  const messages = useMessages(room.id);
  const agents = useAgents();
  const me = useMe();
  const reactToMessage = useReactToMessage();
  const displayAgents = useMemo(() => roomAgents(agents, room), [agents, room]);
  const shellMode = useShellMode();
  const listRef = useAutoScrollbar<HTMLDivElement>();
  const lastSeenMessageId = useRef<string | null>(null);
  const [threadSummaryWidth, setThreadSummaryWidth] = useState(() => {
    const stored = Number(localStorage.getItem("synchronize.threadSummaryWidth"));
    return Number.isFinite(stored) && stored >= THREAD_SUMMARY_MIN_WIDTH && stored <= THREAD_SUMMARY_MAX_WIDTH
      ? stored
      : THREAD_SUMMARY_DEFAULT_WIDTH;
  });
  const agentById = useMemo(() => new Map(displayAgents.map((agent) => [agent.id, agent] as const)), [displayAgents]);

  // Stable identity so the memo()'d MessageRow isn't invalidated on every
  // scroll-driven re-render of this component (which would re-parse markdown).
  const handleReact = useCallback(
    (messageId: string, emoji: string) => void reactToMessage({ messageId, roomId: room.id, emoji, op: "toggle" }),
    [reactToMessage, room.id],
  );

  useEffect(() => {
    localStorage.setItem("synchronize.threadSummaryWidth", String(threadSummaryWidth));
  }, [threadSummaryWidth]);

  const rows = useMemo(() => {
    let prevAuthor: string | null = null;
    return messages.map((m, index) => {
      const grouped = prevAuthor === m.authorId;
      const hasFollowup = messages[index + 1]?.authorId === m.authorId;
      prevAuthor = m.authorId;
      const author = agentById.get(m.authorId);
      return { m, author, grouped, hasFollowup };
    });
  }, [messages, agentById]);
  // Content-aware size estimate. The chat holds very long markdown bubbles, so a
  // flat estimate produces large deltas the first time a row is measured — which
  // is exactly what reads as a "choppy" shift when a row enters the window.
  // Estimating from body length + the row's adornments keeps unmeasured rows
  // close to their real height, so the layout barely moves on first measure.
  const estimateRowHeight = useCallback(
    (index: number) => {
      const row = rows[index];
      if (!row) return 140;
      const body = row.m.body ?? "";
      const CHARS_PER_LINE = 72;
      const LINE_HEIGHT = 21;
      const PARAGRAPH_GAP = 12;
      const textLines = body
        .split("\n")
        .reduce((n, line) => n + Math.max(1, Math.ceil(line.length / CHARS_PER_LINE)), 0);
      const paragraphCount = body.trim() ? body.trim().split(/\n{2,}/).length : 0;
      let h = textLines * LINE_HEIGHT + 26; // text + bubble padding
      h += Math.max(0, paragraphCount - 1) * PARAGRAPH_GAP;
      if (!row.grouped) h += 26; // author header line
      if (row.m.reactions.length) h += 30;
      if (row.m.poll) h += 60 + row.m.poll.options.length * 34;
      if (row.m.attachments?.length) h += 180;
      if (row.m.threadReplyCount) h += 30; // thread badge
      h += row.hasFollowup ? 6 : 16; // .message-virtual-row padding-bottom
      return Math.max(row.grouped ? 56 : 84, h);
    },
    [rows],
  );

  // Large overscan = the "always-loaded buffer" — rows well outside the viewport
  // are mounted and measured ahead of time in BOTH directions, so by the time the
  // user scrolls to them they already have their real height and never reflow.
  // Trades memory (more mounted DOM/markdown) for scroll smoothness, by design.
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => listRef.current,
    estimateSize: estimateRowHeight,
    overscan: 28,
    // Key by message id so the measurement cache survives list growth and
    // older-message prepends — and so cached sizes stay attached to the right
    // bubble rather than to a shifting index.
    getItemKey: (index) => rows[index]?.m.id ?? index,
    // Don't re-measure rows while scrolling UP. TanStack's default remeasures
    // backward-entering rows and rewrites scrollTop to compensate, which is the
    // visible "jump"/stutter on up-scroll (TanStack/virtual#659). Once a row has
    // a cached size, trust it on the way back up; only measure forward/first-seen
    // rows. Combined with shouldAdjustScrollPositionOnItemSizeChange=false below,
    // up-scroll has nothing to correct.
    measureElement: (element, _entry, instance) => {
      const measured = Math.round(element.getBoundingClientRect().height);
      const inst = instance as unknown as {
        scrollDirection: "forward" | "backward" | null;
        itemSizeCache: Map<string | number, number>;
        options: { getItemKey: (i: number) => string | number };
      };
      if (inst.scrollDirection === "backward") {
        const dataIndex = Number((element as HTMLElement).dataset["index"]);
        if (Number.isFinite(dataIndex)) {
          const cached = inst.itemSizeCache.get(inst.options.getItemKey(dataIndex));
          if (cached != null) return cached;
        }
      }
      return measured;
    },
  });
  // Never let a size change drive scrollTop (belt-and-suspenders with the
  // backward measureElement cache above).
  (virtualizer as ResizeAdjustmentVirtualizer).shouldAdjustScrollPositionOnItemSizeChange = () => false;

  // ── Thread Summary panel support ──────────────────────────────────────────
  // The panel aligns each thread's dot to its parent message and scroll-syncs
  // with this list. Because the list is virtualized, we expose message offsets
  // from the virtualizer rather than from the DOM.
  const indexByMessageId = useMemo(
    () => new Map(rows.map((row, index) => [row.m.id, index] as const)),
    [rows],
  );
  const getAnchorTop = useCallback(
    (messageId: string): number | null => {
      const index = indexByMessageId.get(messageId);
      if (index === undefined) return null;
      // `measurementsCache` holds every item's absolute offset in content
      // space (measured where rendered, estimated otherwise) — unlike
      // getOffsetForIndex, which clamps to the scrollable range. We want the
      // raw content offset so dots track their bubble even near the ends. The
      // cache is refreshed every render via getTotalSize()/getVirtualItems().
      const m = virtualizer.measurementsCache[index];
      if (!m) return null;
      return m.start + m.size / 2;
    },
    [indexByMessageId, virtualizer],
  );
  const getContentHeight = useCallback(() => virtualizer.getTotalSize(), [virtualizer]);
  const handleJumpTo = useCallback(
    (messageId: string) => {
      const index = indexByMessageId.get(messageId);
      if (index === undefined) return;
      virtualizer.scrollToIndex(index, { align: "center" });
      // Flash the bubble once it has been rendered into the DOM.
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          const el = document.getElementById(`msg-${messageId}`);
          if (!el) return;
          el.classList.add("flash-highlight");
          window.setTimeout(() => el.classList.remove("flash-highlight"), 2400);
        }),
      );
    },
    [indexByMessageId, virtualizer],
  );

  // Deep link / cross-room jump: scroll the virtualized list to the target and
  // flash it once it has hydrated into `rows`. Reuses handleJumpTo (the same path
  // the thread-summary panel uses), then signals the parent to clear the target
  // so a later message arrival doesn't re-trigger the flash.
  useEffect(() => {
    if (!focusMessageId) return;
    if (!indexByMessageId.has(focusMessageId)) return;
    handleJumpTo(focusMessageId);
    onFocusedMessage?.();
  }, [focusMessageId, indexByMessageId, handleJumpTo, onFocusedMessage]);

  useEffect(() => {
    const last = messages.at(-1);
    if (!last) return;
    const seen = lastSeenMessageId.current;
    lastSeenMessageId.current = last.id;
    if (seen === null || seen === last.id || last.authorId !== me.id) return;
    requestAnimationFrame(() => {
      virtualizer.scrollToIndex(messages.length - 1, { align: "end" });
    });
  }, [messages, me.id, virtualizer]);

  return (
    <div
      className={cn(
        "chat-view flex h-full min-h-0 flex-col",
        room.kind === "group" && "is-group-room",
        threadSummaryOpen && "has-thread-summary",
      )}
      data-vim-panel="chat"
    >
      {threadSummaryOpen && (
        <ThreadSummaryPanel
          messages={messages}
          agents={displayAgents}
          onJumpTo={handleJumpTo}
          {...(onOpenThread ? { onOpenThread } : {})}
          width={threadSummaryWidth}
          onWidthChange={setThreadSummaryWidth}
          {...(onToggleThreadSummary ? { onClose: onToggleThreadSummary } : {})}
          chatListRef={listRef}
          getAnchorTop={getAnchorTop}
          getContentHeight={getContentHeight}
        />
      )}
      <div className="chat-col flex min-h-0 min-w-0 flex-1 flex-col">
        {/* Top region: the chat scroll area. The composer lives BELOW this
            region, spanning the full chat-column width. `.chat-region` is kept
            as a structural hook. */}
        <div className="chat-region flex min-h-0 flex-1 flex-col [border-bottom:var(--composer-separator-line,2px_solid_var(--rule))]">
          <div className="chat-scroll-wrap relative flex min-h-0 flex-1 flex-col">
            {/* `.chat-list` keeps its overscroll-behavior + scrollbar rules in
                styles.css (scroll-perf, not inlinable); `.virtualized-list`
                resets display:block over the base flex. `.autoscroll` drives the
                useAutoScrollbar `is-scrolling` hook. */}
            <div className="chat-list autoscroll virtualized-list block min-h-0 flex-1 overflow-y-auto pt-[18px] pr-6 pb-[10px] pl-[18px]" ref={listRef}>
              <div className="virtualized-spacer" style={{ height: virtualizer.getTotalSize() }}>
                {virtualizer.getVirtualItems().map((item) => {
                  const row = rows[item.index];
                  if (!row?.author) return null;
                  return (
                    <div
                      key={row.m.id}
                      className={cn(
                        "virtualized-row message-virtual-row",
                        row.hasFollowup ? "has-followup pb-[var(--space-6)]" : "pb-[var(--space-16)]",
                        row.grouped && "is-grouped",
                      )}
                      data-index={item.index}
                      ref={virtualizer.measureElement}
                      style={{ transform: `translateY(${item.start}px)` }}
                    >
                      <MessageRow
                        message={row.m}
                        author={row.author}
                        agents={displayAgents}
                        groupedWithPrev={row.grouped}
                        onReact={handleReact}
                        {...(onOpenDm ? { onOpenDm } : {})}
                        {...(onOpenThread ? { onOpenThread } : {})}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
            <ScrollControls targetRef={listRef} newItemsKey={messages.at(-1)?.id ?? null} />
          </div>
        </div>
        <Composer
          key={isThreadOpen ? "thread-open" : "thread-closed"}
          roomId={room.id}
          collapsedDefault={isThreadOpen && shellMode === "compact"}
          {...(onToggleThreadSummary ? { threadSummaryOpen, onToggleThreadSummary } : {})}
        />
      </div>
    </div>
  );
}
