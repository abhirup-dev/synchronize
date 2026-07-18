import { memo, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { cn } from "../lib/cn.ts";
import type { Agent, Message } from "../data/types.ts";
import { Avatar, IdentityText, MentionChip } from "./primitives.tsx";
import { Markdown } from "./Markdown.tsx";
import { useContextMenu, type MenuEntry } from "./ContextMenu.tsx";
import { PollWidget } from "./PollWidget.tsx";
import { useMe } from "../data/context.tsx";
import { isSelfAgent } from "../data/identity.ts";
import { AttachmentPreviewList } from "./AttachmentPreview.tsx";
import { AgentProfileDialog } from "./AgentPreview.tsx";
import { useToast } from "./Toast.tsx";
import { useArchiveWorkflow } from "./ArchiveRecovery.tsx";
import { agentActionMenuItems } from "./agentActionMenu.ts";
import { messageDeepLinkUrl } from "../deeplinks.ts";
import { copyText } from "../utils/clipboard.ts";

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
  /** Miniature 20px avatar (thread pane): no status ring, no role glyph —
   *  just the sigil tile sitting inline with the author-name text. */
  miniAvatar?: boolean;
  /** Compact thread headers already carry the parent author. */
  hideAuthor?: boolean;
  /** Compact thread rows use the composer/context menu as the primary action surface. */
  hideReactionAdd?: boolean;
  onOpenDm?(agentId: string): void;
}

const QUICK_REACTIONS = ["👍", "✅", "👀", "🎉", "🚀", "❤️", "🙏", "😂"];
const OVERLAY_CLOSE_EVENT = "synchronize:overlay-close";
const FLOATING_PICKER_HEIGHT = 88;
const FLOATING_POPOVER_HEIGHT = 96;
const MESSAGE_TIME = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" });

function harnessLabel(agent: Agent): string {
  const value = agent.runtimeDetails?.tool ?? agent.runtimeDetails?.hostTool ?? agent.handle;
  if (/claude/i.test(value)) return "Claude Code";
  if (/codex|openai/i.test(value)) return "Codex";
  if (/pi/i.test(value)) return "Pi";
  if (/letta/i.test(value)) return "Letta";
  return value;
}

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

export const MessageRow = memo(function MessageRow({
  message,
  author,
  agents,
  groupedWithPrev,
  onOpenThread,
  onReact,
  hideAvatar,
  miniAvatar,
  hideAuthor,
  hideReactionAdd,
  onOpenDm,
}: MessageRowProps) {
  const openMenu = useContextMenu();
  const rowRef = useRef<HTMLDivElement | null>(null);
  const me = useMe();
  const toast = useToast();
  const archive = useArchiveWorkflow();
  // The local operator shares the same transcript geometry as every other
  // author; isSelf only controls the quieter tonal treatment and monogram.
  const isSelf = isSelfAgent(author, me);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerStyle, setPickerStyle] = useState<FloatingStyle | null>(null);
  const [detailsEmoji, setDetailsEmoji] = useState<string | null>(null);
  const [detailsStyle, setDetailsStyle] = useState<FloatingStyle | null>(null);
  const [profileAgent, setProfileAgent] = useState<Agent | null>(null);
  const agentById = useMemo(() => new Map(agents.map((agent) => [agent.id, agent] as const)), [agents]);
  const threadReplyCount = message.threadReplyCount ?? 0;
  const hasThreadBadge = threadReplyCount > 0 && Boolean(onOpenThread);
  const threadParticipantNames = (message.threadParticipantIds ?? [])
    .slice(0, 4)
    .map((id) => agentById.get(id)?.name)
    .filter((name): name is string => Boolean(name));

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

  const copyMessageBody = async () => {
    const copied = await copyText(message.body);
    toast.show(copied ? "Message copied" : "Could not copy message", { kind: copied ? "success" : "error" });
  };

  const copyMessageLink = async () => {
    const copied = await copyText(messageDeepLinkUrl(message.id));
    toast.show(copied ? "Message link copied" : "Could not copy message link", { kind: copied ? "success" : "error" });
  };

  const messageMenuItems = (): MenuEntry[] => [
    ...(onOpenThread ? [{ label: "Reply in thread", onSelect: () => onOpenThread(message.id) }] : []),
    ...(onReact && !hideReactionAdd ? [{ label: "Add reaction", onSelect: () => openPicker(rowRef.current?.querySelector<HTMLElement>(".message-action-react, .reaction.add")) }] : []),
    { label: "Copy text", shortcut: "⌘C", onSelect: copyMessageBody },
    { label: "Copy link", onSelect: copyMessageLink },
    { divider: true },
    { label: "Pin to room (soon)", disabled: true, onSelect: () => {} },
    { divider: true },
    { label: "Delete (soon)", danger: true, disabled: true, onSelect: () => {} },
  ];

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
    <>
    <div
      ref={rowRef}
      id={`msg-${message.id}`}
      data-vim-item={`msg-${message.id}`}
      className={cn(
        "message-row grid grid-cols-[34px_minmax(0,880px)] items-start gap-[var(--space-4)]",
        isSelf && "is-self",
        groupedWithPrev && "is-grouped",
        hideAvatar && "no-avatar",
        !hideAvatar && miniAvatar && "mini-avatar",
      )}
      onContextMenu={(e) => openMenu(e, messageMenuItems())}
    >
      {!hideAvatar && (
        <div
          className={cn("message-gutter flex justify-center pt-0", miniAvatar ? "h-[20px]" : "h-[30px]")}
          onContextMenu={(e) =>
            openMenu(e, agentActionMenuItems(e, {
              agent: author,
              toast,
              archive,
              ...(onOpenDm ? { onOpenDm: () => onOpenDm(author.id) } : {}),
              onViewProfile: () => setProfileAgent(author),
            }))
          }
        >
          {!groupedWithPrev && (
            <Avatar agent={author} size={miniAvatar ? 20 : 32} showStatus={!miniAvatar && !isSelf} />
          )}
        </div>
      )}
      {/* Reference inlay actions are quiet JetBrains Mono glyphs (↳ ↻ ⋯ …),
          not an icon-font pack — see sigil/design.md §5.1. */}
      <div className="message-actions" role="group" aria-label="message actions">
        {onOpenThread ? (
          <button type="button" className="message-action" aria-label="reply in thread" title="Reply in thread" onClick={() => onOpenThread(message.id)}>
            <span aria-hidden="true">↳</span>
          </button>
        ) : null}
        {onReact && !hideReactionAdd ? (
          <button type="button" className="message-action message-action-react" aria-label="add reaction" title="Add reaction" onClick={(event) => openPicker(event.currentTarget)}>
            <span aria-hidden="true">☺</span>
          </button>
        ) : null}
        <button type="button" className="message-action" aria-label="copy message text" title="Copy message" onClick={() => void copyMessageBody()}>
          <span aria-hidden="true">⧉</span>
        </button>
        <button type="button" className="message-action" aria-label="copy message link" title="Copy link" onClick={() => void copyMessageLink()}>
          <span aria-hidden="true">↻</span>
        </button>
        <button type="button" className="message-action" aria-label="more message actions" title="More actions" onClick={(event) => openMenu(event, messageMenuItems())}>
          <span aria-hidden="true">⋯</span>
        </button>
      </div>
      <div className="message-body flex min-w-0 flex-col gap-[var(--space-2)] pr-[var(--bubble-shadow-gutter,6px)] pb-[var(--bubble-shadow-gutter,6px)]">
        {!hideAuthor && !groupedWithPrev && (
          <div className={cn("author-chip", isSelf && "is-self-author")}>
            {isSelf ? (
              <span className="author-name identity-name-pill">{author.name}</span>
            ) : (
              <IdentityText
                className="author-name identity-name-pill"
                color={author.color}
                {...(author.colorRef ? { colorRef: author.colorRef } : null)}
              >
                {author.name}
              </IdentityText>
            )}
            <span className="author-harness">{isSelf ? "operator" : harnessLabel(author)}</span>
            <span className="message-time">{MESSAGE_TIME.format(new Date(message.createdAt))}</span>
          </div>
        )}
        <div className="message-stack">
          {groupedWithPrev ? <span className="message-continuation-time">{MESSAGE_TIME.format(new Date(message.createdAt))}</span> : null}
          <div className="bubble">
            {message.body.trim() && <BodyWithMentions body={message.body} agents={agents} />}
            {message.attachments?.length ? (
              <AttachmentPreviewList attachments={message.attachments} mode="message" />
            ) : null}
            {message.poll && (
              <PollWidget poll={message.poll} me={me.id} agents={agents} onVote={(opt) => console.log("vote", message.id, opt)} />
            )}
          </div>
          {/* Reactions are DATA — show them whenever the message has any, not only
              when an onReact handler happens to be wired. (Footer also appears for
              an interactive add-reaction affordance or a thread badge.) Decoupling
              display from handlers keeps read-only mounts and stories truthful. */}
          {(hasThreadBadge || message.reactions.length > 0 || (onReact && !hideReactionAdd)) && (
            <div
              className={cn(
                "message-footer mt-px flex min-h-[26px] w-full items-center justify-between gap-[var(--space-8)]",
                !hasThreadBadge && message.reactions.length === 0 && "is-action-only",
              )}
            >
              <div className="message-footer-left flex min-w-0 flex-[1_1_auto] items-center">
                {hasThreadBadge && (
                  <button
                    // ref .tfoot: `.thread` is 12/700 accent sans; `.meta` is mono 9.5 fg3.
                    // Font shorthand lives unlayered in extra.css (.thread-badge).
                    className="thread-badge mt-0 inline-flex min-w-0 w-fit cursor-pointer items-baseline gap-[var(--space-6)] rounded-sm bg-transparent py-1 px-0 text-[color:var(--accent)] [border:var(--line-none)] hover:underline"
                    aria-label={`Open thread with ${threadReplyCount} ${threadReplyCount === 1 ? "reply" : "replies"}`}
                    onClick={() => onOpenThread?.(message.id)}
                  >
                    <span className="thread-badge-arrow" aria-hidden="true">↳</span>
                    <span className="thread-badge-count">
                      {threadReplyCount} {threadReplyCount === 1 ? "reply" : "replies"}
                    </span>
                    {message.threadLastReplyAt ? (
                      <span className="thread-badge-time font-mono text-[length:var(--text-9-5)] font-normal text-ink-faint [text-decoration:none]">
                        last {new Date(message.threadLastReplyAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
                      </span>
                    ) : null}
                    {threadParticipantNames.length > 0 ? (
                      <span className="thread-badge-participants truncate font-mono text-[length:var(--text-9-5)] font-normal text-ink-faint">
                        · {threadParticipantNames.join(", ")}
                      </span>
                    ) : null}
                  </button>
                )}
              </div>
              <div className="message-footer-right ml-auto flex min-w-0 flex-[0_1_auto] items-center justify-end">
                <div className="reactions flex flex-wrap items-center justify-end gap-[var(--space-6)]" aria-label="message reactions">
                  {message.reactions.map((reaction) => {
                    const mine = reaction.by.includes(me.id);
                    const names = reaction.by.map((id) => agentById.get(id)?.name ?? id);
                    return (
                      <span
                        className="reaction-wrap relative inline-flex shrink-0"
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
                          className={cn("reaction", mine && "is-mine")}
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
                          <span className="rcount font-mono text-[length:var(--text-11)] font-bold">{reaction.by.length}</span>
                        </button>
                        {detailsEmoji === reaction.emoji && createPortal(
                          <div
                            className={cn(
                              "reaction-popover absolute right-0 bottom-[calc(100%+8px)] z-40 min-w-[168px] overflow-hidden rounded-lg bg-paper p-3 text-left text-[length:var(--text-12)] [border:var(--line-md)] shadow-overlay",
                              detailsStyle && "is-floating fixed z-[var(--z-context-menu)]",
                            )}
                            role="dialog"
                            aria-label={`${reaction.emoji} reactions`}
                            style={detailsStyle ?? undefined}
                          >
                            <div className="reaction-popover-head mb-[6px] text-[20px]">{reaction.emoji}</div>
                            {names.map((name, index) => (
                              <div className="reaction-person my-[3px] font-display" key={`${reaction.emoji}-${reaction.by[index]}`}>{name}</div>
                            ))}
                          </div>,
                          document.body,
                        )}
                      </span>
                    );
                  })}
                  {onReact && !hideReactionAdd && (
                    <span className="reaction-wrap relative inline-flex shrink-0">
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
                          className={cn(
                            "reaction-picker absolute right-0 bottom-[calc(100%+8px)] z-40 grid grid-cols-[repeat(4,34px)] gap-1 overflow-hidden rounded-lg bg-paper p-[6px] [border:var(--line-md)] shadow-overlay",
                            pickerStyle && "is-floating fixed z-[var(--z-context-menu)]",
                          )}
                          role="menu"
                          aria-label="choose reaction"
                          style={pickerStyle ?? undefined}
                        >
                          {QUICK_REACTIONS.map((emoji) => (
                            <button
                              key={emoji}
                              className="reaction-choice grid h-[34px] w-[34px] cursor-pointer place-items-center rounded-md bg-paper text-[18px] text-ink [border:var(--line-sm)] hover:bg-paper-3 hover:shadow-control"
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
    <AgentProfileDialog agent={profileAgent} onClose={() => setProfileAgent(null)} />
    </>
  );
});

function BodyWithMentions({ body, agents }: { body: string; agents: Agent[] }) {
  // Substitute `@handle` with backticked tokens so they appear as inline-code in
  // the markdown AST. The Markdown component overrides the inline-code renderer
  // to detect mention tokens and render a colored MentionChip instead.
  const rewritten = useMemo(() => {
    const handles = agents.map((a) => a.handle).filter(Boolean).sort((a, b) => b.length - a.length);
    if (handles.length === 0) return body;
    // Case-insensitive: seed/message bodies write "@Cortex" while handles are
    // lowercase; the token keeps the author's casing for display.
    const re = new RegExp(`@(${handles.map(escapeRegExp).join("|")})(?=$|\\s|[!?;:,)\\]}'’]|\\.(?=$|\\s))`, "gi");
    return body.replace(re, (_, h) => `\`@@${h}\``);
  }, [body, agents]);
  return <Markdown agents={agents} variant="rich">{rewritten}</Markdown>;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
