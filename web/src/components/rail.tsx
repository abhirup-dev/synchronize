import {
  createContext,
  useContext,
  useRef,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { cn } from "../lib/cn.ts";

// ── Expanding-rail control standard ────────────────────────────────────────
// A single control language for every top-of-surface single-select cluster
// (room tabs, activity filters, layout toggle, artifacts grid/list, …).
//
//   Rail        — the recessed well container holding segments.
//   RailSegment — a square icon at rest; the ONE .active segment expands into a
//                 raised pane revealing its real <span> label (and, for filters,
//                 a trailing count badge) with a short staggered slide.
//   RailChip    — a standalone companion control (sort / mark-all / working /
//                 room menu) sharing the well's height + surface. Never
//                 accent-filled except a genuine .active toggle state.
//
// All geometry/motion/colour comes from the --rail-* tokens (tokens.css);
// rail.css carries inline fallbacks so the primitives render correctly before
// those land. The design intent goes in the MARKUP here (lucide icons, real
// label spans) — never :nth-child / ::after content hacks.
//
// INVARIANT: exactly ONE accent pane per Rail — pass `active` on a single child.
// This is a caller contract (not enforced at runtime); multiple active segments
// would render multiple panes and break the "one selection" reading.

type RailRole = "tablist" | "radiogroup" | "toolbar";
type RailItemRole = "tab" | "radio" | "button";

const ITEM_ROLE: Record<RailRole, RailItemRole> = {
  tablist: "tab",
  radiogroup: "radio",
  toolbar: "button",
};

const RailContext = createContext<RailItemRole>("tab");

interface RailProps {
  children: ReactNode;
  /** ARIA container role; segments derive their item role from it. */
  role?: RailRole;
  /** Accessible name for the cluster (required for tablist/radiogroup/toolbar). */
  "aria-label"?: string;
  className?: string;
}

export function Rail({ children, role = "tablist", className, ...aria }: RailProps) {
  const ref = useRef<HTMLDivElement>(null);

  // Roving focus across the segments (ArrowKeys/Home/End). Enter/Space select
  // natively because each segment is a real <button>.
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const keys = ["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp", "Home", "End"];
    if (!keys.includes(event.key) || !ref.current) return;
    const items = Array.from(
      ref.current.querySelectorAll<HTMLButtonElement>("[data-rail-seg]"),
    );
    if (!items.length) return;
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    let next: number;
    if (event.key === "Home") next = 0;
    else if (event.key === "End") next = items.length - 1;
    else if (event.key === "ArrowRight" || event.key === "ArrowDown")
      next = current < 0 ? 0 : (current + 1) % items.length;
    else next = current < 0 ? items.length - 1 : (current - 1 + items.length) % items.length;
    event.preventDefault();
    items[next]?.focus();
  }

  return (
    <RailContext.Provider value={ITEM_ROLE[role]}>
      <div
        ref={ref}
        role={role}
        aria-label={aria["aria-label"]}
        className={cn("rail", className)}
        onKeyDown={onKeyDown}
      >
        {children}
      </div>
    </RailContext.Provider>
  );
}

interface RailSegmentProps {
  /** A lucide icon element; sized to --rail-icon via CSS. */
  icon: ReactNode;
  /** Real, visible-when-active label. Required — never CSS `content`. */
  label: string;
  active?: boolean;
  /** Optional trailing count badge (filters). Collapses to 0 width when inactive. */
  count?: number;
  /** Action-oriented hover explanation; defaults to the visible label. */
  tooltip?: string;
  onSelect?: () => void;
  className?: string;
}

export function RailSegment({ icon, label, active = false, count, tooltip, onSelect, className }: RailSegmentProps) {
  const itemRole = useContext(RailContext);
  const stateProps =
    itemRole === "tab"
      ? { "aria-selected": active }
      : itemRole === "radio"
        ? { "aria-checked": active }
        : { "aria-pressed": active };

  return (
    <button
      type="button"
      role={itemRole}
      data-rail-seg=""
      data-label={label}
      data-tooltip={tooltip ?? label}
      // Roving tabindex for the single-select rails (tablist/radiogroup): the
      // active pane is the tab stop, arrows reach the rest — one child is always
      // active there. A toolbar has no always-active guarantee, so its segments
      // stay individually tabbable and never become keyboard-unreachable.
      tabIndex={itemRole === "button" || active ? 0 : -1}
      onClick={onSelect}
      className={cn("rail-seg", active && "active", className)}
      {...stateProps}
    >
      <span className="rail-seg-icon" aria-hidden>
        {icon}
      </span>
      <span className="rail-seg-label">{label}</span>
      {count != null && (
        <span className="rail-seg-count" aria-hidden>
          {count}
        </span>
      )}
    </button>
  );
}

interface RailChipProps {
  icon?: ReactNode;
  label?: string;
  /** Compact value/count rendered after the label. */
  badge?: ReactNode;
  /** Trailing disclosure or status glyph. */
  trailing?: ReactNode;
  active?: boolean;
  /** Toggle semantics — renders aria-pressed. */
  pressed?: boolean;
  /** Hover tooltip pill + accessible name when there is no visible label. */
  tooltip?: string;
  disabled?: boolean;
  onClick?: () => void;
  className?: string;
  ariaLabel?: string;
  expanded?: boolean;
  title?: string;
}

export function RailChip({ icon, label, badge, trailing, active = false, pressed, tooltip, disabled, onClick, className, ariaLabel, expanded, title }: RailChipProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={pressed}
      aria-expanded={expanded}
      aria-label={ariaLabel ?? (label ? undefined : tooltip)}
      title={title}
      data-tooltip={tooltip}
      className={cn("rail-chip", active && "active", className)}
    >
      {icon != null && (
        <span className="rail-chip-icon" aria-hidden>
          {icon}
        </span>
      )}
      {label && <span className="rail-chip-label">{label}</span>}
      {badge != null && <span className="rail-chip-badge">{badge}</span>}
      {trailing != null && <span className="rail-chip-trailing" aria-hidden>{trailing}</span>}
    </button>
  );
}
