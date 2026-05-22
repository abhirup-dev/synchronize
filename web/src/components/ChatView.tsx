import { useMemo } from "react";
import type { Room } from "../data/types.ts";
import { useAgents, useMessages } from "../data/context.tsx";
import { MessageRow } from "./MessageRow.tsx";
import { Composer } from "./Composer.tsx";
import { useAutoScrollbar } from "../hooks/useAutoScrollbar.ts";
import { ScrollControls } from "./ScrollControls.tsx";
import { TimelineRail } from "./TimelineRail.tsx";

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
    <div className="chat-view" data-vim-panel="chat">
      {/* Top region: chat scroll area + timeline rail, side by side. The
          composer lives BELOW this region so the timeline ends at the top of
          the composer rather than running the full height of the panel. */}
      <div className="chat-region">
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
