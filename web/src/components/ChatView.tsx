import { useMemo } from "react";
import type { Room } from "../data/types.ts";
import { useAgents, useMessages } from "../data/context.tsx";
import { MessageRow } from "./MessageRow.tsx";
import { Composer } from "./Composer.tsx";
import { useAutoScrollbar } from "../hooks/useAutoScrollbar.ts";
import { ScrollControls } from "./ScrollControls.tsx";

export function ChatView({ room, onOpenThread }: { room: Room; onOpenThread?(parentId: string): void }) {
  const messages = useMessages(room.id);
  const agents = useAgents();
  const listRef = useAutoScrollbar<HTMLDivElement>();

  const rows = useMemo(() => {
    let prevAuthor: string | null = null;
    return messages.map((m) => {
      const grouped = prevAuthor === m.authorId;
      prevAuthor = m.authorId;
      const author = agents.find((a) => a.id === m.authorId);
      return { m, author, grouped };
    });
  }, [messages, agents]);

  return (
    <div className="chat-view">
      <div className="chat-scroll-wrap">
      <div className="chat-list autoscroll" ref={listRef}>
        {rows.map(({ m, author, grouped }) =>
          author ? (
            <MessageRow
              key={m.id}
              message={m}
              author={author}
              agents={agents}
              groupedWithPrev={grouped}
              {...(onOpenThread ? { onOpenThread } : {})}
            />
          ) : null,
        )}
      </div>
        <ScrollControls targetRef={listRef} />
      </div>
      <Composer roomId={room.id} />
    </div>
  );
}
