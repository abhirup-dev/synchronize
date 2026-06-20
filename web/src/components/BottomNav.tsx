import type { LucideIcon } from "lucide-react";
import { MessagesSquare, Activity, Bot } from "lucide-react";
import { cn } from "../lib/cn.ts";

export type BottomNavTab = "chats" | "activity" | "agents";

interface BottomNavProps {
  active: BottomNavTab;
  onChats(): void;
  onActivity(): void;
  onAgents(): void;
  /** Member/agent count badge on the Agents tab. */
  agentCount?: number | undefined;
}

interface TabSpec {
  id: BottomNavTab;
  icon: LucideIcon;
  label: string;
  onSelect(): void;
  badge?: number | undefined;
}

// Compact-only bottom navigation (root chrome) — three thumb-zone destinations
// following Material 3 / iOS bottom-bar conventions: 56px min row, ≥44px touch
// targets, icon + label, a single highlighted active item. Rendered only when
// shellMode === "compact" (App.tsx); desktop/medium never mount it. Glyphs use
// currentColor so every data-theme palette works.
export function BottomNav({ active, onChats, onActivity, onAgents, agentCount }: BottomNavProps) {
  const tabs: TabSpec[] = [
    { id: "chats", icon: MessagesSquare, label: "Chats", onSelect: onChats },
    { id: "activity", icon: Activity, label: "Activity", onSelect: onActivity },
    { id: "agents", icon: Bot, label: "Agents", onSelect: onAgents, badge: agentCount },
  ];

  return (
    <nav
      className="bottom-nav grid grid-cols-3 [border-top:var(--line)] bg-paper-2"
      aria-label="primary"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      {tabs.map((tab) => {
        const isActive = active === tab.id;
        const Icon = tab.icon;
        return (
          <button
            key={tab.id}
            type="button"
            aria-label={tab.label}
            aria-current={isActive ? "page" : undefined}
            onClick={tab.onSelect}
            className={cn(
              // bg MUST be set explicitly: bare <button> otherwise falls back to
              // the UA button-face (light grey), which breaks dark themes.
              "relative flex flex-col items-center justify-center gap-[3px] min-h-[56px] px-[4px] cursor-pointer outline-none select-none bg-transparent",
              "[transition:color_140ms_ease,background_140ms_ease] active:scale-[0.96]",
              "hover:[background:color-mix(in_srgb,var(--ink)_8%,transparent)]",
              "focus-visible:[box-shadow:inset_0_0_0_2px_var(--yellow)]",
              // Active = bright ink + the yellow top indicator (rendered below);
              // inactive = muted. Color, not a filled chip — iOS/Material idiom.
              isActive ? "text-ink" : "text-ink-soft hover:text-ink",
            )}
          >
            {isActive && (
              <span
                aria-hidden
                className="absolute top-0 left-1/2 -translate-x-1/2 h-[3px] w-[34px] rounded-b-[var(--radius-xs)] bg-yellow"
              />
            )}
            <span className="relative inline-grid place-items-center">
              <Icon size={22} strokeWidth={isActive ? 2.4 : 2} absoluteStrokeWidth aria-hidden />
              {tab.badge ? (
                <span className="absolute -top-[6px] -right-[10px] min-w-[16px] h-[16px] px-[3px] inline-grid place-items-center rounded-pill bg-ink text-paper font-mono text-[length:var(--text-10)] leading-none">
                  {tab.badge}
                </span>
              ) : null}
            </span>
            <span className="font-display text-[length:var(--text-10)] tracking-[var(--tracking-sm)] leading-none">
              {tab.label}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
