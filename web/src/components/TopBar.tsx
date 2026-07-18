import type { ReactNode } from "react";
import { cva } from "class-variance-authority";
import { cn } from "../lib/cn.ts";

/**
 * The unified top bar (Sigil ref `.head`) — ONE single-row bar shared by every
 * main-column view; each view composes its own contents from these pieces:
 *
 *   RoomHeader     → TopBarTitle(# room) · TopBarMeta · TabGroup(surface) · crew
 *   ActivityView   → TopBarTitle(Activity) · TopBarMeta · TabGroup(filter) ·
 *                    TabGroup(layout) · live/sort controls
 *
 * The bar is chat-column chrome (it never spans the sidebar or an open thread
 * pane). Tokens flow from the styles.css contract via the tw.css `@theme
 * inline` bridge; `top-bar`, `top-bar-meta`, `top-tab` stay as skin hooks. */

export function TopBar({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <header className={cn("top-bar", "flex items-center gap-[13px] px-[28px] py-[13px] [border-bottom:var(--line)] bg-paper", className)}>
      {children}
    </header>
  );
}

export function TopBarTitle({ children }: { children: ReactNode }) {
  return (
    <h2 className="top-bar-title flex items-center m-0 min-w-0 font-ui text-[length:var(--text-15-5)] font-bold leading-[1.1]">
      {children}
    </h2>
  );
}

export function TopBarMeta({ children }: { children: ReactNode }) {
  return (
    <span className="top-bar-meta font-mono text-[length:var(--text-9-5)] text-ink-faint tracking-[0.05em] uppercase whitespace-nowrap overflow-hidden text-ellipsis">
      {children}
    </span>
  );
}

// Segmented text control (ref `.head .tabs`) — the one switcher for every
// exclusive choice in the bar: room surface (Chat/Board/Artifacts), activity
// filter (All/Mentions/Awaiting), activity layout (Grouped/Flat).
const topTab = cva(
  [
    "top-tab bg-transparent [border:var(--line-none)] rounded-md px-[14px] py-[5px] cursor-pointer",
    "text-[length:var(--text-12)] font-semibold text-ink-soft hover:text-ink whitespace-nowrap",
  ],
  {
    variants: {
      active: {
        true: "bg-paper-3 text-ink",
        false: "",
      },
    },
    defaultVariants: { active: false },
  },
);

export interface TabGroupItem<Id extends string = string> {
  id: Id;
  label: string;
  /** Optional accent count rendered after the label (ref `.tabs span .n`). */
  count?: number;
  /** Hover tooltip — same pill as the top-bar chips (extra.css). */
  tooltip?: string;
}

export function TabGroup<Id extends string>({
  items,
  value,
  onChange,
  ariaLabel,
  className,
}: {
  items: readonly TabGroupItem<Id>[];
  value: NoInfer<Id>;
  onChange(id: NoInfer<Id>): void;
  ariaLabel: string;
  className?: string;
}) {
  return (
    <div className={cn("tab-group flex bg-paper-2 [border:var(--line-2)] rounded-lg p-[3px]", className)} role="tablist" aria-label={ariaLabel}>
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          role="tab"
          aria-selected={value === item.id}
          className={cn(topTab({ active: value === item.id }))}
          data-tooltip={item.tooltip}
          onClick={() => onChange(item.id)}
        >
          {item.label}
          {item.count !== undefined && (
            <span className="ml-[5px] font-mono text-[length:var(--text-10)] text-[color:var(--accent)]">{item.count}</span>
          )}
        </button>
      ))}
    </div>
  );
}
