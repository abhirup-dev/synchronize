import { useEffect, useMemo, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { Room } from "../data/types.ts";
import { useAgents, useMe, useMessages } from "../data/context.tsx";
import { MessageRow } from "./MessageRow.tsx";
import { Composer } from "./Composer.tsx";
import { useAutoScrollbar } from "../hooks/useAutoScrollbar.ts";
import { ScrollControls } from "./ScrollControls.tsx";
import { TimelineRail } from "./TimelineRail.tsx";
import { roomAgents } from "../data/roomAgents.ts";

export function ChatView({
  room,
  onOpenThread,
  isThreadOpen = false,
}: {
  room: Room;
  onOpenThread?(parentId: string): void;
  isThreadOpen?: boolean;
}) {
  const messages = useMessages(room.id);
  const agents = useAgents();
  const me = useMe();
  const displayAgents = useMemo(() => roomAgents(agents, room), [agents, room]);
  const listRef = useAutoScrollbar<HTMLDivElement>();
  const lastSeenMessageId = useRef<string | null>(null);
  const agentById = useMemo(() => new Map(displayAgents.map((agent) => [agent.id, agent] as const)), [displayAgents]);

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
    <div className="chat-view" data-vim-panel="chat">
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
      />
    </div>
  );
}
