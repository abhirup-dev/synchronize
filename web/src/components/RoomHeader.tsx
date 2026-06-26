import { cva } from "class-variance-authority";
import { cn } from "../lib/cn.ts";
import { useAgents } from "../data/context.tsx";
import type { Room } from "../data/types.ts";
import { Avatar, IdentityBadge, IdentityLogoTile, RoomNameInline } from "./primitives.tsx";
import { roomAgents } from "../data/roomAgents.ts";
import type { Agent } from "../data/types.ts";
import { useContextMenu } from "./ContextMenu.tsx";
import { CHAT_BACKGROUNDS } from "../data/chatBackgrounds.ts";
import { useIsCompact } from "../shell-mode.tsx";
import { IconButton } from "./IconButton.tsx";
import { Settings } from "lucide-react";
import type { MouseEvent as ReactMouseEvent } from "react";

export type RoomTab = "chat" | "board" | "artifacts";

/**
 * Tokens flow from the styles.css contract via the tw.css `@theme inline`
 * bridge; values without a utility namespace (border shorthand, tracking /
 * space / text tokens) use arbitrary values. Skin-hook classes (`room-header`,
 * `room-tab`) are retained alongside utilities — their base declarations moved
 * here, while `.room-tab.active` + `[data-theme]` overrides stay in extra.css.
 * Shared classes (`icon-btn`, `author-name`, `thread-pane-*`) are untouched. */

// Tab pill. Keeps the `room-tab` hook so skin-glass.css + the .active /
// [data-theme] rules in extra.css still bind; the active state is a plain class
// appended at the call site so those CSS rules own the active styling.
const roomTab = cva([
  "room-tab topbar-control",
]);

interface RoomHeaderProps {
  room: Room;
  tab: RoomTab;
  onTab(t: RoomTab): void;
  theme: string;
  onToggleTheme(shiftKey: boolean): void;
  skin: "brutal" | "glass";
  onToggleSkin(): void;
  chatBg: string;
  onChatBg(id: string): void;
  showAgentsButton?: boolean;
  onOpenAgents?(): void;
  onOpenSettings?(event: ReactMouseEvent<HTMLButtonElement>): void;
  threadBanner?: {
    author: Agent;
    onClose(): void;
  };
}

export function RoomHeader({
  room,
  tab,
  onTab,
  theme,
  onToggleTheme,
  skin,
  onToggleSkin,
  chatBg,
  onChatBg,
  showAgentsButton = false,
  onOpenAgents,
  onOpenSettings,
  threadBanner,
}: RoomHeaderProps) {
  const agents = useAgents();
  const openMenu = useContextMenu();
  const compact = useIsCompact();
  const displayAgents = roomAgents(agents, room);
  const members = room.members.map((id) => displayAgents.find((a) => a.id === id)).filter(Boolean) as import("../data/types.ts").Agent[];
  const working = members.filter((m) => m.status === "busy").length;

  return (
    <header className={cn("room-header", "[border-bottom:var(--line)] bg-paper")}>
      <div className="room-header-top flex items-center gap-[var(--space-16)] pt-[16px] px-[22px] pb-[12px]">
        <div className="room-id flex items-center gap-[14px] flex-[1_1_520px] min-w-0">
          {room.kind === "group" ? (
            <IdentityLogoTile as="div" className="room-id-icon room-glyph-icon w-[46px] h-[46px] min-w-[46px] [border:var(--line)] grid place-items-center font-display text-[length:var(--text-22)] shadow-sm" color={room.color}>
              {room.emoji ?? "#"}
            </IdentityLogoTile>
          ) : (
            <IdentityBadge as="div" className="room-id-icon w-[46px] h-[46px] min-w-[46px] [border:var(--line)] rounded-lg grid place-items-center font-display text-[length:var(--text-22)] shadow-sm" color={room.color}>
              {room.emoji ?? room.name[0]?.toUpperCase() ?? "#"}
            </IdentityBadge>
          )}
          <div className="flex flex-col justify-center min-w-0 flex-[1_1_auto]">
            <div className="room-title font-display text-[length:var(--text-22)] flex items-center leading-[1.1] min-w-0">
              <RoomNameInline
                kind={room.kind}
                name={room.name}
                showPrefix={room.kind !== "group"}
                className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap"
              />
            </div>
            {room.description ? <div className="text-[length:var(--text-11)] text-ink-soft mt-[5px] max-w-[min(72ch,100%)] overflow-hidden text-ellipsis whitespace-nowrap">{room.description}</div> : null}
          </div>
        </div>

        {/* The working-count meta and the member pile are desktop/medium chrome.
            Gate them OUT of the DOM in compact (not just display:none) — an empty
            wrapper would still claim a grid cell and bump the actions to a 2nd
            row. The bottom-nav Agents tab carries member presence on mobile. */}
        {!compact && (
          <>
            <div className="room-working-meta flex-none min-w-[120px] flex flex-col items-end justify-center text-right">
              <div className="room-meta font-mono text-[length:var(--text-11)] text-ink-soft mt-[3px] flex items-center justify-end gap-[var(--space-10)]">
                <span className="inline-flex items-center gap-[var(--space-6)] text-ink font-extrabold"><span className="w-[9px] h-[9px] rounded-pill bg-pink [border:var(--line-sm)] shadow-xs" />{working} / {members.length} working</span>
              </div>
            </div>

            <div className="member-pile flex items-center">
              {members.slice(0, 6).map((a, i) => (
                <span key={a.id} className="inline-block ml-[var(--space-0)] [&+span]:ml-[calc(var(--space-8)*-1)]" style={{ zIndex: members.length - i }}>
                  <Avatar agent={a} size={28} />
                </span>
              ))}
            </div>
          </>
        )}

        {compact ? (
          // Compact: a single thumb-sized Lucide button. The settings-y toggles
          // (theme/skin/chat-bg) fold into an overflow menu so the header bar
          // stays to a single tight row beside the title.
          <div className="room-header-actions flex items-center gap-[var(--space-2)]">
            <IconButton
              icon={Settings}
              label="open display settings"
              size={40}
              iconSize={19}
              onClick={(event) => {
                if (onOpenSettings) {
                  onOpenSettings(event);
                  return;
                }
                openMenu(event, [
                  { label: `Theme · ${theme}`, onSelect: () => onToggleTheme(false) },
                  { label: `Skin · ${skin === "brutal" ? "brutal → glass" : "glass → brutal"}`, onSelect: onToggleSkin },
                  { divider: true },
                  ...CHAT_BACKGROUNDS.map((preset) => ({
                    label: `${preset.id === chatBg ? "✓ " : ""}${preset.name}`,
                    onSelect: () => onChatBg(preset.id),
                  })),
                ]);
              }}
            />
          </div>
        ) : (
          <div className="room-header-actions flex gap-[6px]">
            {showAgentsButton && (
              <button className="icon-btn room-agents-btn inline-flex items-center justify-center gap-[var(--space-6)] font-display text-[length:var(--text-10)] tracking-[var(--tracking-sm)]" aria-label="open agents" onClick={onOpenAgents}>
                <span className="room-agents-label">AGENTS</span>
                <span className="min-w-[18px] h-[18px] inline-grid place-items-center rounded-sm bg-ink text-paper font-mono text-[length:var(--text-10)] tracking-normal">{members.length}</span>
              </button>
            )}
          </div>
        )}
      </div>

      <div className="room-tabs topbar-strip relative flex items-center gap-[var(--space-8)] pt-[10px] px-[22px] pb-[10px] [border-top:var(--line-2)]">
        {(["chat", "board", "artifacts"] as RoomTab[]).map((t) => (
          <button
            key={t}
            className={cn(roomTab(), tab === t && "active")}
            onClick={() => onTab(t)}
          >
            {t === "chat" ? "💬 CHAT" : t === "board" ? "▦ BOARD" : "▤ ARTIFACTS"}
          </button>
        ))}
        {threadBanner ? (
          <div className="absolute top-0 right-0 bottom-0 w-[min(var(--thread-pane-width,420px),46vw)] min-w-0 flex items-center justify-between gap-[var(--space-12)] px-[22px] font-mono text-ink-soft" aria-label={`thread replying to ${threadBanner.author.name}`}>
            <div className="min-w-0 flex items-center gap-[var(--space-8)] [&_strong]:font-display [&_strong]:text-[length:var(--text-13)] [&_strong]:text-ink">
              <strong>Thread</strong>
              <span className="thread-pane-sep">·</span>
              <span className="thread-pane-sub">replying to</span>
              <IdentityBadge className="author-name min-w-0 max-w-[min(220px,34vw)] p-[var(--space-thread-author-chip-pad)] [border:var(--line-sm)] rounded-sm shadow-chip font-display text-[length:var(--text-11)] overflow-hidden text-ellipsis whitespace-nowrap" color={threadBanner.author.color}>
                {threadBanner.author.name}
              </IdentityBadge>
            </div>
            <button className="thread-pane-close flex-none" onClick={threadBanner.onClose} aria-label="close thread">×</button>
          </div>
        ) : (
          <div className="room-activity ml-auto font-mono text-[length:var(--text-10)] text-ink-soft flex items-center gap-[var(--space-8)]">
            ROOM ACTIVITY
            <span className="tracking-[var(--tracking-pixel)] text-ink">▁▂▃▅▆▇▆▅▃▂</span>
          </div>
        )}
      </div>
    </header>
  );
}
