import { memo, useMemo, useState } from "react";
import type { Agent, Message } from "../data/types.ts";
import { Avatar, MentionChip, inkFor } from "./primitives.tsx";
import { Markdown } from "./Markdown.tsx";
import { useContextMenu } from "./ContextMenu.tsx";
import { PollWidget } from "./PollWidget.tsx";
import { useMe } from "../data/context.tsx";

interface MessageRowProps {
  message: Message;
  author: Agent;
  agents: Agent[];
  groupedWithPrev: boolean;
  onOpenThread?(parentId: string): void;
  onReact?(messageId: string, emoji: string): void;
  /** Hide the avatar gutter (used in ThreadPane to reclaim horizontal space —
   *  the colored author-name pill above the bubble is enough identity there). */
  hideAvatar?: boolean;
}

const QUICK_REACTIONS = ["👍", "✅", "👀", "🎉", "🚀", "❤️", "🙏", "😂"];

export const MessageRow = memo(function MessageRow({ message, author, agents, groupedWithPrev, onOpenThread, onReact, hideAvatar }: MessageRowProps) {
  const isYou = author.id === "you";
  const openMenu = useContextMenu();
  const me = useMe();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [detailsEmoji, setDetailsEmoji] = useState<string | null>(null);
  const agentById = useMemo(() => new Map(agents.map((agent) => [agent.id, agent] as const)), [agents]);
  const threadReplyCount = message.threadReplyCount ?? 0;
  const hasThreadBadge = threadReplyCount > 0 && Boolean(onOpenThread);
  return (
    <div
      id={`msg-${message.id}`}
      data-vim-item={`msg-${message.id}`}
      className={`message-row${isYou ? " is-you" : ""}${groupedWithPrev ? " is-grouped" : ""}${hideAvatar ? " no-avatar" : ""}`}
      onContextMenu={(e) =>
        openMenu(e, [
          { label: "Reply in thread", onSelect: () => onOpenThread?.(message.id) },
          { label: "Add reaction", onSelect: () => setPickerOpen(true) },
          { label: "Copy text", shortcut: "⌘C", onSelect: () => navigator.clipboard?.writeText(message.body) },
          { label: "Copy link", onSelect: () => console.log("link", message.id) },
          { divider: true },
          { label: "Pin to room", onSelect: () => console.log("pin", message.id) },
          { divider: true },
          { label: "Delete", danger: true, onSelect: () => console.log("delete", message.id) },
        ])
      }
    >
      {!hideAvatar && (
        <div className="message-gutter">
          {!groupedWithPrev && <Avatar agent={author} size={34} showStatus />}
        </div>
      )}
      <div className="message-body">
        {!groupedWithPrev && (
          <div className="author-chip">
            <span
              className="author-name"
              style={{
                background: author.color,
                color: inkFor(author.color),
                fontFamily: "var(--font-display)",
                fontSize: "var(--text-12)",
                letterSpacing: "var(--tracking-xs)",
                padding: "var(--space-author-chip-pad)",
                border: "var(--line-sm)",
                borderRadius: "var(--radius-md)",
                boxShadow: "var(--shadow-sm)",
                display: "inline-flex",
                alignItems: "center",
                lineHeight: 1.2,
              }}
            >
              {author.name}
            </span>
          </div>
        )}
        <div className="bubble">
          <BodyWithMentions body={message.body} agents={agents} />
          {message.poll && (
            <PollWidget poll={message.poll} me={me.id} agents={agents} onVote={(opt) => console.log("vote", message.id, opt)} />
          )}
        </div>
        {(hasThreadBadge || onReact) && (
          <div className="message-footer">
            <div className="message-footer-left">
              {hasThreadBadge && (
                <button className="thread-badge" onClick={() => onOpenThread?.(message.id)}>
                  <span className="thread-badge-avs">
                    {(message.threadParticipantIds ?? []).slice(0, 4).map((aid) => {
                      const a = agents.find((x) => x.id === aid);
                      if (!a) return null;
                      return (
                        <span
                          key={aid}
                          className="thread-badge-av"
                          title={a.name}
                          style={{ background: a.color, color: inkFor(a.color) }}
                        >
                          {a.avatar}
                        </span>
                      );
                    })}
                  </span>
                  <span className="thread-badge-count">
                    {threadReplyCount} {threadReplyCount === 1 ? "reply" : "replies"}
                  </span>
                  {message.threadLastReplyAt && (
                    <span className="thread-badge-time">
                      last {new Date(message.threadLastReplyAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
                    </span>
                  )}
                </button>
              )}
            </div>
            <div className="message-footer-right">
              <div className="reactions" aria-label="message reactions">
                {message.reactions.map((reaction) => {
                  const mine = reaction.by.includes(me.id);
                  const names = reaction.by.map((id) => agentById.get(id)?.name ?? id);
                  return (
                    <span
                      className="reaction-wrap"
                      key={reaction.emoji}
                      onMouseEnter={() => setDetailsEmoji(reaction.emoji)}
                      onMouseLeave={() => setDetailsEmoji((current) => current === reaction.emoji ? null : current)}
                    >
                      <button
                        className={`reaction${mine ? " is-mine" : ""}`}
                        title={names.join(", ")}
                        aria-pressed={mine}
                        aria-label={`${reaction.emoji} reaction from ${names.join(", ")}`}
                        onClick={() => {
                          setPickerOpen(false);
                          onReact?.(message.id, reaction.emoji);
                        }}
                        onFocus={() => setDetailsEmoji(reaction.emoji)}
                        onBlur={() => setDetailsEmoji((current) => current === reaction.emoji ? null : current)}
                      >
                        <span>{reaction.emoji}</span>
                        <span className="rcount">{reaction.by.length}</span>
                      </button>
                      {detailsEmoji === reaction.emoji && (
                        <div className="reaction-popover" role="dialog" aria-label={`${reaction.emoji} reactions`}>
                          <div className="reaction-popover-head">{reaction.emoji}</div>
                          {names.map((name, index) => (
                            <div className="reaction-person" key={`${reaction.emoji}-${reaction.by[index]}`}>{name}</div>
                          ))}
                        </div>
                      )}
                    </span>
                  );
                })}
                {onReact && (
                  <span className="reaction-wrap">
                    <button className="reaction add" aria-label="add reaction" onClick={() => setPickerOpen(!pickerOpen)}>
                      +
                    </button>
                    {pickerOpen && (
                      <div className="reaction-picker" role="menu" aria-label="choose reaction">
                        {QUICK_REACTIONS.map((emoji) => (
                          <button
                            key={emoji}
                            className="reaction-choice"
                            onClick={() => {
                              onReact(message.id, emoji);
                              setPickerOpen(false);
                            }}
                          >
                            {emoji}
                          </button>
                        ))}
                      </div>
                    )}
                  </span>
                )}
              </div>
            </div>
          </div>
        )}
        {message.status && isYou && <MessageStatus status={message.status} />}
      </div>
    </div>
  );
});

function BodyWithMentions({ body, agents }: { body: string; agents: Agent[] }) {
  // Substitute `@handle` with backticked tokens so they appear as inline-code in
  // the markdown AST. The Markdown component overrides the inline-code renderer
  // to detect mention tokens and render a colored MentionChip instead.
  const rewritten = useMemo(() => {
    const handles = agents.map((a) => a.handle).filter(Boolean).sort((a, b) => b.length - a.length);
    if (handles.length === 0) return body;
    const re = new RegExp(`@(${handles.map(escapeRegExp).join("|")})(?=$|\\s|[!?;:,)\\]}]|\\.(?=$|\\s))`, "g");
    return body.replace(re, (_, h) => `\`@@${h}\``);
  }, [body, agents]);
  return <Markdown agents={agents}>{rewritten}</Markdown>;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function MessageStatus({ status }: { status: NonNullable<Message["status"]> }) {
  const label =
    status === "queued"    ? "◌ queued" :
    status === "delivered" ? "✓✓ delivered" : "✓✓ read";
  return <div className="message-status">{label}</div>;
}
