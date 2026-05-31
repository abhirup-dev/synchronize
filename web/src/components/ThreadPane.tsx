import { useEffect, useMemo, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useAgents, useMe, useMessages, useThreadReplies } from "../data/context.tsx";
import type { Room } from "../data/types.ts";
import { MessageRow } from "./MessageRow.tsx";
import { Composer } from "./Composer.tsx";
import { useAutoScrollbar } from "../hooks/useAutoScrollbar.ts";
import { ScrollControls } from "./ScrollControls.tsx";
import { roomAgents } from "../data/roomAgents.ts";
import { inkFor } from "./primitives.tsx";

interface ThreadPaneProps {
  room: Room;
  parentId: string;
  onClose(): void;
}

export function ThreadPane({ room, parentId, onClose }: ThreadPaneProps) {
  const messages = useMessages(room.id);
  const replies = useThreadReplies(parentId);
  const agents = useAgents();
  const me = useMe();
  const displayAgents = useMemo(() => roomAgents(agents, room), [agents, room]);
  const bodyRef = useAutoScrollbar<HTMLDivElement>();
  const lastSeenReplyId = useRef<string | null>(null);
  const agentById = useMemo(() => new Map(displayAgents.map((agent) => [agent.id, agent] as const)), [displayAgents]);
  const parent = useMemo(() => messages.find((m) => m.id === parentId), [messages, parentId]);
  const parentAuthor = parent ? agentById.get(parent.authorId) : undefined;
  const participants = useMemo(() => {
    const ids = new Set<string>();
    replies.forEach((r) => ids.add(r.authorId));
    return [...ids].map((id) => displayAgents.find((a) => a.id === id)).filter(Boolean) as import("../data/types.ts").Agent[];
  }, [replies, displayAgents]);
  const virtualizer = useVirtualizer({
    count: replies.length,
    getScrollElement: () => bodyRef.current,
    estimateSize: () => 150,
    overscan: 6,
  });

  useEffect(() => {
    const last = replies.at(-1);
    if (!last) return;
    const seen = lastSeenReplyId.current;
    lastSeenReplyId.current = last.id;
    if (seen === null || seen === last.id || last.authorId !== me.id) return;
    requestAnimationFrame(() => {
      virtualizer.scrollToIndex(replies.length - 1, { align: "end" });
    });
  }, [replies, me.id, virtualizer]);

  if (!parent || !parentAuthor) return null;

  return (
    <aside className="thread-pane" aria-label="thread" data-vim-panel="thread">
      <header className="thread-pane-head">
        <div className="thread-pane-title">
          <strong>Thread</strong>
          <span className="thread-pane-sep">·</span>
          <span className="thread-pane-sub">replying to</span>
          <span
            className="author-name"
            style={{
              background: parentAuthor.color,
              color: inkFor(parentAuthor.color),
              padding: "var(--space-thread-author-chip-pad)",
              border: "var(--line-sm)",
              borderRadius: "var(--radius-sm)",
              boxShadow: "var(--shadow-chip)",
              fontFamily: "var(--font-display)",
              fontSize: "var(--text-11)",
            }}
          >
            {parentAuthor.name}
          </span>
        </div>
        <button className="thread-pane-close" onClick={onClose} aria-label="close thread">×</button>
      </header>

      <div className="thread-scroll-wrap">
      <div className="thread-pane-body autoscroll" ref={bodyRef}>
        <div className="thread-parent">
          <MessageRow message={parent} author={parentAuthor} agents={displayAgents} groupedWithPrev={false} hideAvatar />
        </div>

        <div className="thread-divider">
          <span className="thread-divider-line" />
          <span className="thread-divider-label">
            {replies.length} {replies.length === 1 ? "reply" : "replies"}
            {participants.length > 0 && ` · ${participants.length} participant${participants.length === 1 ? "" : "s"}`}
          </span>
          <span className="thread-divider-line" />
        </div>

        {replies.length === 0 ? (
          <div className="thread-empty">no replies yet — start the conversation below.</div>
        ) : (
          <div className="thread-replies virtualized-spacer" style={{ height: virtualizer.getTotalSize() }}>
            {virtualizer.getVirtualItems().map((item) => {
              const r = replies[item.index];
              if (!r) return null;
              const author = agentById.get(r.authorId);
              if (!author) return null;
              return (
                <div
                  key={r.id}
                  className="virtualized-row thread-virtual-row"
                  data-index={item.index}
                  ref={virtualizer.measureElement}
                  style={{ transform: `translateY(${item.start}px)` }}
                >
                  <MessageRow
                    message={r}
                    author={author}
                    agents={displayAgents}
                    groupedWithPrev={false}
                    hideAvatar
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>
        <ScrollControls targetRef={bodyRef} newItemsKey={replies.at(-1)?.id ?? null} />
      </div>

      <Composer roomId={room.id} parentMessageId={parentId} />
    </aside>
  );
}
