import { useMemo } from "react";
import { useAgents, useMessages, useThreadReplies } from "../data/context.tsx";
import type { Room } from "../data/types.ts";
import { MessageRow } from "./MessageRow.tsx";
import { Composer } from "./Composer.tsx";
import { useAutoScrollbar } from "../hooks/useAutoScrollbar.ts";
import { ScrollControls } from "./ScrollControls.tsx";

interface ThreadPaneProps {
  room: Room;
  parentId: string;
  onClose(): void;
}

export function ThreadPane({ room, parentId, onClose }: ThreadPaneProps) {
  const messages = useMessages(room.id);
  const replies = useThreadReplies(parentId);
  const agents = useAgents();
  const bodyRef = useAutoScrollbar<HTMLDivElement>();
  const parent = useMemo(() => messages.find((m) => m.id === parentId), [messages, parentId]);
  const parentAuthor = parent ? agents.find((a) => a.id === parent.authorId) : undefined;
  const participants = useMemo(() => {
    const ids = new Set<string>();
    replies.forEach((r) => ids.add(r.authorId));
    return [...ids].map((id) => agents.find((a) => a.id === id)).filter(Boolean) as import("../data/types.ts").Agent[];
  }, [replies, agents]);

  if (!parent || !parentAuthor) return null;

  return (
    <aside className="thread-pane" aria-label="thread">
      <header className="thread-pane-head">
        <div className="thread-pane-title">
          <strong>Thread</strong>
          <span className="thread-pane-sep">·</span>
          <span className="thread-pane-sub">replying to</span>
          <span
            className="author-name"
            style={{
              background: parentAuthor.color,
              padding: "2px 8px",
              border: "2px solid var(--rule)",
              borderRadius: 4,
              boxShadow: "1.5px 1.5px 0 var(--rule)",
              fontFamily: "Archivo Black, sans-serif",
              fontSize: 11,
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
          <MessageRow message={parent} author={parentAuthor} agents={agents} groupedWithPrev={false} />
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
          <div className="thread-replies">
            {replies.map((r) => {
              const author = agents.find((a) => a.id === r.authorId);
              if (!author) return null;
              return (
                <MessageRow
                  key={r.id}
                  message={r}
                  author={author}
                  agents={agents}
                  groupedWithPrev={false}
                />
              );
            })}
          </div>
        )}
      </div>
        <ScrollControls targetRef={bodyRef} />
      </div>

      <Composer roomId={room.id} parentMessageId={parentId} />
    </aside>
  );
}
