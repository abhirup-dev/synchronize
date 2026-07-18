import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft } from "lucide-react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useAgents, useMe, useMessages, useReactToMessage, useThreadReplies } from "../data/context.tsx";
import type { Room } from "../data/types.ts";
import { MessageRow } from "./MessageRow.tsx";
import { Composer } from "./Composer.tsx";
import { useAutoScrollbar } from "../hooks/useAutoScrollbar.ts";
import { ScrollControls } from "./ScrollControls.tsx";
import { roomAgents } from "../data/roomAgents.ts";
import { IdentityText, RoomNameInline } from "./primitives.tsx";
import { cn } from "../lib/cn.ts";
import { useIsCompact } from "../shell-mode.tsx";

interface ThreadPaneProps {
  room: Room;
  parentId: string;
  focusMessageId?: string;
  onFocused?(): void;
  onClose(): void;
  showHeader?: boolean;
}

function flashMessage(id: string): void {
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      const el = document.getElementById(`msg-${id}`);
      if (!el) return;
      el.classList.add("flash-highlight");
      window.setTimeout(() => el.classList.remove("flash-highlight"), 2400);
    }),
  );
}

export function ThreadPane({ room, parentId, focusMessageId, onFocused, onClose, showHeader = true }: ThreadPaneProps) {
  const compact = useIsCompact();
  const [parentExpanded, setParentExpanded] = useState(false);
  const messages = useMessages(room.id);
  const replies = useThreadReplies(parentId);
  const agents = useAgents();
  const me = useMe();
  const reactToMessage = useReactToMessage();
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
    setParentExpanded(false);
  }, [parentId]);

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

  useEffect(() => {
    // Activity and deep links open the pane on an arbitrary row, not always the
    // thread root. focusMessageId === parentId means "focus the root"; otherwise
    // center the matching reply once the virtualized list materializes. Flash the
    // landed row, then signal the parent to clear the target.
    if (!focusMessageId) return;
    if (focusMessageId === parentId) {
      flashMessage(parentId);
      onFocused?.();
      return;
    }
    const index = replies.findIndex((reply) => reply.id === focusMessageId);
    if (index < 0) return;
    requestAnimationFrame(() => {
      virtualizer.scrollToIndex(index, { align: "center" });
    });
    flashMessage(focusMessageId);
    onFocused?.();
  }, [focusMessageId, parentId, replies, virtualizer, onFocused]);

  if (!parent || !parentAuthor) return null;
  const parentCollapsible = compact && parent.body.length > 900;
  const parentCollapsed = parentCollapsible && !parentExpanded;

  return (
    <aside
      className={cn(
        "thread-pane",
        "relative flex min-h-0 flex-col overflow-hidden bg-paper [border-left:var(--line-md)]",
        "animate-[thread-slide-in_200ms_cubic-bezier(0.2,0.8,0.2,1)]",
      )}
      aria-label="thread"
      data-vim-panel="thread"
    >
      {showHeader && (
        <header className={cn(
          "thread-pane-header flex shrink-0 items-center gap-[var(--space-12)] bg-paper-2 [border-bottom:var(--line)] [padding:var(--space-button-pad-md)]",
          compact ? "justify-start" : "justify-between",
          compact && "min-h-[56px] gap-[var(--space-8)] px-[8px] py-[8px]",
        )}>
          {compact && (
            <button className="thread-pane-close" onClick={onClose} aria-label="back to activity">
              <ChevronLeft size={22} strokeWidth={2.4} aria-hidden />
            </button>
          )}
          <div className="thread-pane-heading flex min-w-0 items-center gap-[var(--space-6)]" style={{ fontFamily: "var(--font-ui)", fontSize: "var(--text-14)", fontWeight: 700 }}>
            <strong>Thread</strong>
            {compact ? (
              <IdentityText
                className="thread-pane-parent-author identity-name-pill"
                color={parentAuthor.color}
                {...(parentAuthor.colorRef ? { colorRef: parentAuthor.colorRef } : null)}
              >
                {parentAuthor.name}
              </IdentityText>
            ) : (
              <>
                <span className="thread-pane-sep">·</span>
                <RoomNameInline kind={room.kind} name={room.name} className="thread-pane-room" />
                <span className="thread-pane-count">· {replies.length}</span>
              </>
            )}
          </div>
          {!compact && <button className="thread-pane-close" onClick={onClose} aria-label="close thread">×</button>}
        </header>
      )}

      <div className="thread-scroll-wrap relative flex min-h-0 flex-1 flex-col [border-bottom:var(--composer-separator-line,2px_solid_var(--rule))]">
      <div className="thread-pane-body autoscroll flex min-h-0 flex-1 flex-col gap-[var(--space-20)] overflow-y-auto [padding:12px_12px_4px]" ref={bodyRef}>
        <div className="thread-parent flex flex-col gap-[var(--space-8)]">
          <div className={cn("relative", parentCollapsed && "max-h-[310px] overflow-hidden")}>
            <MessageRow
              message={parent}
              author={parentAuthor}
              agents={displayAgents}
              groupedWithPrev={false}
              onReact={(messageId, emoji) => void reactToMessage({ messageId, roomId: room.id, emoji, op: "toggle" })}
              hideAvatar={compact}
              miniAvatar={!compact}
              hideAuthor={compact}
              hideReactionAdd={compact}
            />
          </div>
          {parentCollapsible && (
            <button
              className="min-h-[44px] self-center rounded-pill bg-paper-2 px-[16px] py-[8px] font-mono text-[length:var(--text-10)] font-bold text-ink-soft [border:var(--line-sm)] hover:text-ink"
              type="button"
              onClick={() => setParentExpanded((open) => !open)}
            >
              {parentExpanded ? "show less parent" : "show full parent"}
            </button>
          )}
        </div>

        <div className={cn(
          "thread-divider flex items-center gap-[var(--space-10)] font-mono text-[length:var(--text-10)] tracking-[var(--tracking-md)] text-ink-soft [padding:4px_0]",
          compact && "mt-[4px]",
        )}>
          <span className="h-[1.5px] flex-1 bg-ink-faint" />
          <span className="thread-divider-label">
            {replies.length} {replies.length === 1 ? "reply" : "replies"}
            {participants.length > 0 && ` · ${participants.length} participant${participants.length === 1 ? "" : "s"}`}
          </span>
          <span className="h-[1.5px] flex-1 bg-ink-faint" />
        </div>

        {replies.length === 0 ? (
          <div className="font-mono text-[length:var(--text-11)] text-ink-soft [padding:18px_8px] text-center">no replies yet — start the conversation below.</div>
        ) : (
          <div className="virtualized-spacer" style={{ height: virtualizer.getTotalSize() }}>
            {virtualizer.getVirtualItems().map((item) => {
              const r = replies[item.index];
              if (!r) return null;
              const author = agentById.get(r.authorId);
              if (!author) return null;
              // Group consecutive replies from the same sender (same rule as the
              // main chat): a grouped reply drops its author header and sits
              // tighter; a reply followed by the same author trims its gap.
              const grouped = replies[item.index - 1]?.authorId === r.authorId;
              const hasFollowup = replies[item.index + 1]?.authorId === r.authorId;
              return (
                <div
                  key={r.id}
                  className={cn(
                    "virtualized-row thread-virtual-row",
                    hasFollowup ? "has-followup pb-[var(--space-6)]" : "pb-[var(--space-18)]",
                    grouped && "is-grouped",
                  )}
                  data-index={item.index}
                  ref={virtualizer.measureElement}
                  style={{ transform: `translateY(${item.start}px)` }}
                >
                  <MessageRow
                    message={r}
                    author={author}
                    agents={displayAgents}
                    groupedWithPrev={grouped}
                    onReact={(messageId, emoji) => void reactToMessage({ messageId, roomId: room.id, emoji, op: "toggle" })}
                    hideAvatar={compact}
                    miniAvatar={!compact}
                    hideReactionAdd={compact}
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
