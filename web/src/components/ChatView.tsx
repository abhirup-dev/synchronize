import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { Room } from "../data/types.ts";
import { useAgents, useMe, useMessages, useReactToMessage } from "../data/context.tsx";
import { MessageRow } from "./MessageRow.tsx";
import { Composer } from "./Composer.tsx";
import { useAutoScrollbar } from "../hooks/useAutoScrollbar.ts";
import { ScrollControls } from "./ScrollControls.tsx";
import { TimelineRail } from "./TimelineRail.tsx";
import { ThreadSummaryPanel } from "./ThreadSummaryPanel.tsx";
import { roomAgents } from "../data/roomAgents.ts";

const THREAD_SUMMARY_DEFAULT_WIDTH = 340;
const THREAD_SUMMARY_MIN_WIDTH = 240;
const THREAD_SUMMARY_MAX_WIDTH = 620;

export function ChatView({
  room,
  onOpenThread,
  isThreadOpen = false,
  threadSummaryOpen = false,
  onToggleThreadSummary,
}: {
  room: Room;
  onOpenThread?(parentId: string): void;
  isThreadOpen?: boolean;
  threadSummaryOpen?: boolean;
  onToggleThreadSummary?(): void;
}) {
  const messages = useMessages(room.id);
  const agents = useAgents();
  const me = useMe();
  const reactToMessage = useReactToMessage();
  const displayAgents = useMemo(() => roomAgents(agents, room), [agents, room]);
  const listRef = useAutoScrollbar<HTMLDivElement>();
  const lastSeenMessageId = useRef<string | null>(null);
  const [threadSummaryWidth, setThreadSummaryWidth] = useState(() => {
    const stored = Number(localStorage.getItem("synchronize.threadSummaryWidth"));
    return Number.isFinite(stored) && stored >= THREAD_SUMMARY_MIN_WIDTH && stored <= THREAD_SUMMARY_MAX_WIDTH
      ? stored
      : THREAD_SUMMARY_DEFAULT_WIDTH;
  });
  const agentById = useMemo(() => new Map(displayAgents.map((agent) => [agent.id, agent] as const)), [displayAgents]);

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
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => listRef.current,
    estimateSize: (index) => rows[index]?.grouped ? 112 : 170,
    overscan: 8,
  });

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
    <div className={`chat-view${threadSummaryOpen ? " has-thread-summary" : ""}`} data-vim-panel="chat">
      {threadSummaryOpen && (
        <ThreadSummaryPanel
          messages={messages}
          agents={displayAgents}
          onJumpTo={handleJumpTo}
          width={threadSummaryWidth}
          onWidthChange={setThreadSummaryWidth}
          chatListRef={listRef}
          getAnchorTop={getAnchorTop}
          getContentHeight={getContentHeight}
        />
      )}
      <div className="chat-col">
        {/* Top region: chat scroll area + timeline rail, side by side. The
            composer lives BELOW this region so the timeline ends at the top of
            the composer rather than running the full height of the panel. */}
        <div className="chat-region">
          <div className="chat-scroll-wrap">
            <div className="chat-list autoscroll virtualized-list" ref={listRef}>
              <div className="virtualized-spacer" style={{ height: virtualizer.getTotalSize() }}>
                {virtualizer.getVirtualItems().map((item) => {
                  const row = rows[item.index];
                  if (!row?.author) return null;
                  return (
                    <div
                      key={row.m.id}
                      className={`virtualized-row message-virtual-row${row.grouped ? " is-grouped" : ""}${row.hasFollowup ? " has-followup" : ""}`}
                      data-index={item.index}
                      ref={virtualizer.measureElement}
                      style={{ transform: `translateY(${item.start}px)` }}
                    >
                      <MessageRow
                        message={row.m}
                        author={row.author}
                        agents={displayAgents}
                        groupedWithPrev={row.grouped}
                        onReact={(messageId, emoji) => void reactToMessage({ messageId, roomId: room.id, emoji, op: "toggle" })}
                        {...(onOpenThread ? { onOpenThread } : {})}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
            <ScrollControls targetRef={listRef} newItemsKey={messages.at(-1)?.id ?? null} />
          </div>
          {!isThreadOpen && <TimelineRail roomId={room.id} />}
        </div>
        <Composer
          key={isThreadOpen ? "thread-open" : "thread-closed"}
          roomId={room.id}
          collapsedDefault={isThreadOpen}
          {...(onToggleThreadSummary ? { threadSummaryOpen, onToggleThreadSummary } : {})}
        />
      </div>
    </div>
  );
}
