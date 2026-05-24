import { memo, useMemo } from "react";
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
  /** Hide the avatar gutter (used in ThreadPane to reclaim horizontal space —
   *  the colored author-name pill above the bubble is enough identity there). */
  hideAvatar?: boolean;
}

export const MessageRow = memo(function MessageRow({ message, author, agents, groupedWithPrev, onOpenThread, hideAvatar }: MessageRowProps) {
  const isYou = author.id === "you";
  const openMenu = useContextMenu();
  const me = useMe();
  return (
    <div
      id={`msg-${message.id}`}
      data-vim-item={`msg-${message.id}`}
      className={`message-row${isYou ? " is-you" : ""}${groupedWithPrev ? " is-grouped" : ""}${hideAvatar ? " no-avatar" : ""}`}
      onContextMenu={(e) =>
        openMenu(e, [
          { label: "Reply in thread", onSelect: () => onOpenThread?.(message.id) },
          { label: "Add reaction", onSelect: () => console.log("react", message.id) },
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
        {message.threadReplyCount !== undefined && message.threadReplyCount > 0 && onOpenThread && (
          <button className="thread-badge" onClick={() => onOpenThread(message.id)}>
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
              {message.threadReplyCount} {message.threadReplyCount === 1 ? "reply" : "replies"}
            </span>
            {message.threadLastReplyAt && (
              <span className="thread-badge-time">
                last {new Date(message.threadLastReplyAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
              </span>
            )}
          </button>
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
    const re = new RegExp(`@(${handles.map(escapeRegExp).join("|")})(?![a-zA-Z0-9._-])`, "g");
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
