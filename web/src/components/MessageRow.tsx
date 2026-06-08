import { memo, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import type { Agent, Message } from "../data/types.ts";
import { Avatar, IdentityBadge, MentionChip } from "./primitives.tsx";
import { Markdown } from "./Markdown.tsx";
import { useContextMenu } from "./ContextMenu.tsx";
import { PollWidget } from "./PollWidget.tsx";
import { useMe } from "../data/context.tsx";
import { AttachmentPreviewList } from "./AttachmentPreview.tsx";

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
const OVERLAY_CLOSE_EVENT = "synchronize:overlay-close";
const FLOATING_PICKER_HEIGHT = 88;
const FLOATING_POPOVER_HEIGHT = 96;

type FloatingStyle = Pick<CSSProperties, "top" | "right" | "bottom">;

function floatingStyleFor(anchor: HTMLElement, height: number): FloatingStyle {
  const rect = anchor.getBoundingClientRect();
  const above = rect.top >= height + 12;
  return {
    right: Math.max(8, window.innerWidth - rect.right),
    top: above ? "auto" : Math.min(window.innerHeight - height - 8, rect.bottom + 8),
    bottom: above ? window.innerHeight - rect.top + 8 : "auto",
  };
}

export const MessageRow = memo(function MessageRow({ message, author, agents, groupedWithPrev, onOpenThread, onReact, hideAvatar }: MessageRowProps) {
  const openMenu = useContextMenu();
  const rowRef = useRef<HTMLDivElement | null>(null);
  const me = useMe();
  const isYou = author.id === me.id || author.id === "you";
  const isWebAuthor = author.role === "web";
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerStyle, setPickerStyle] = useState<FloatingStyle | null>(null);
  const [detailsEmoji, setDetailsEmoji] = useState<string | null>(null);
  const [detailsStyle, setDetailsStyle] = useState<FloatingStyle | null>(null);
  const agentById = useMemo(() => new Map(agents.map((agent) => [agent.id, agent] as const)), [agents]);
  const threadReplyCount = message.threadReplyCount ?? 0;
  const hasThreadBadge = threadReplyCount > 0 && Boolean(onOpenThread);

  const closeReactionOverlays = () => {
    setPickerOpen(false);
    setPickerStyle(null);
    setDetailsEmoji(null);
    setDetailsStyle(null);
  };

  const openPicker = (anchor?: HTMLElement | null) => {
    window.dispatchEvent(new CustomEvent(OVERLAY_CLOSE_EVENT));
    setDetailsEmoji(null);
    setDetailsStyle(null);
    setPickerStyle(anchor ? floatingStyleFor(anchor, FLOATING_PICKER_HEIGHT) : null);
    setPickerOpen(true);
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      closeReactionOverlays();
    };
    window.addEventListener(OVERLAY_CLOSE_EVENT, closeReactionOverlays);
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("keyup", onKeyDown, true);
    window.addEventListener("scroll", closeReactionOverlays, true);
    return () => {
      window.removeEventListener(OVERLAY_CLOSE_EVENT, closeReactionOverlays);
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("keyup", onKeyDown, true);
      window.removeEventListener("scroll", closeReactionOverlays, true);
    };
  }, []);

  return (
    <div
      ref={rowRef}
      id={`msg-${message.id}`}
      data-vim-item={`msg-${message.id}`}
      className={`message-row${isYou ? " is-you" : ""}${isWebAuthor ? " is-web-author" : ""}${groupedWithPrev ? " is-grouped" : ""}${hideAvatar ? " no-avatar" : ""}`}
      onContextMenu={(e) =>
        openMenu(e, [
          { label: "Reply in thread", onSelect: () => onOpenThread?.(message.id) },
          { label: "Add reaction", onSelect: () => openPicker(rowRef.current?.querySelector(".reaction.add")) },
          { label: "Copy text", shortcut: "⌘C", onSelect: () => navigator.clipboard?.writeText(message.body) },
          { label: "Copy link", onSelect: () => console.log("link", message.id) },
          { divider: true },
          { label: "Pin to room", onSelect: () => console.log("pin", message.id) },
          { divider: true },
          { label: "Delete", danger: true, onSelect: () => console.log("delete", message.id) },
        ])
      }
    >
      {!hideAvatar && !isWebAuthor && (
        <div className="message-gutter">
          {!groupedWithPrev && <Avatar agent={author} size={34} showStatus />}
        </div>
      )}
      <div className="message-body">
        {!groupedWithPrev && !isWebAuthor && (
          <div className="author-chip">
            <IdentityBadge
              className="author-name"
              color={author.color}
              style={{
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
              } as CSSProperties}
            >
              {author.name}
            </IdentityBadge>
          </div>
        )}
        <div className="message-stack">
          <div className="bubble">
            {message.body.trim() && <BodyWithMentions body={message.body} agents={agents} />}
            {message.attachments?.length ? (
              <AttachmentPreviewList attachments={message.attachments} mode="message" />
            ) : null}
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
                          <IdentityBadge
                            key={aid}
                            className="thread-badge-av"
                            color={a.color}
                            title={a.name}
                          >
                            {a.avatar}
                          </IdentityBadge>
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
                        onMouseEnter={(event) => {
                          window.dispatchEvent(new CustomEvent(OVERLAY_CLOSE_EVENT));
                          setDetailsEmoji(reaction.emoji);
                          setDetailsStyle(floatingStyleFor(event.currentTarget, FLOATING_POPOVER_HEIGHT));
                        }}
                        onMouseLeave={() => {
                          setDetailsEmoji((current) => current === reaction.emoji ? null : current);
                          setDetailsStyle(null);
                        }}
                      >
                        <button
                          className={`reaction${mine ? " is-mine" : ""}`}
                          title={names.join(", ")}
                          aria-pressed={mine}
                          aria-label={`${reaction.emoji} reaction from ${names.join(", ")}`}
                          onClick={() => {
                            setPickerOpen(false);
                            setPickerStyle(null);
                            onReact?.(message.id, reaction.emoji);
                          }}
                          onFocus={(event) => {
                            window.dispatchEvent(new CustomEvent(OVERLAY_CLOSE_EVENT));
                            setDetailsEmoji(reaction.emoji);
                            setDetailsStyle(floatingStyleFor(event.currentTarget, FLOATING_POPOVER_HEIGHT));
                          }}
                          onBlur={() => {
                            setDetailsEmoji((current) => current === reaction.emoji ? null : current);
                            setDetailsStyle(null);
                          }}
                        >
                          <span>{reaction.emoji}</span>
                          <span className="rcount">{reaction.by.length}</span>
                        </button>
                        {detailsEmoji === reaction.emoji && createPortal(
                          <div
                            className={`reaction-popover${detailsStyle ? " is-floating" : ""}`}
                            role="dialog"
                            aria-label={`${reaction.emoji} reactions`}
                            style={detailsStyle ?? undefined}
                          >
                            <div className="reaction-popover-head">{reaction.emoji}</div>
                            {names.map((name, index) => (
                              <div className="reaction-person" key={`${reaction.emoji}-${reaction.by[index]}`}>{name}</div>
                            ))}
                          </div>,
                          document.body,
                        )}
                      </span>
                    );
                  })}
                  {onReact && (
                    <span className="reaction-wrap">
                      <button
                        className="reaction add"
                        aria-label="add reaction"
                        onClick={(event) => {
                          if (pickerOpen) {
                            closeReactionOverlays();
                          } else {
                            openPicker(event.currentTarget);
                          }
                        }}
                      >
                        +
                      </button>
                      {pickerOpen && createPortal(
                        <div
                          className={`reaction-picker${pickerStyle ? " is-floating" : ""}`}
                          role="menu"
                          aria-label="choose reaction"
                          style={pickerStyle ?? undefined}
                        >
                          {QUICK_REACTIONS.map((emoji) => (
                            <button
                              key={emoji}
                              className="reaction-choice"
                              onClick={() => {
                                onReact(message.id, emoji);
                                setPickerOpen(false);
                                setPickerStyle(null);
                              }}
                            >
                              {emoji}
                            </button>
                          ))}
                        </div>,
                        document.body,
                      )}
                    </span>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
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
