import { useEffect, useRef, useState, type RefObject } from "react";
import { cva } from "class-variance-authority";
import { cn } from "../lib/cn";

/**
 * Pill button pinned inside the floating controls strip. Tokens come from the
 * styles.css contract via the tw.css `@theme inline` bridge; values without a
 * utility namespace (border shorthand, per-property transitions, keyframe
 * animation) use arbitrary values. The `new-message-pop` keyframes stay in
 * extra.css — only the rules were migrated, not the @keyframes.
 */
const scrollCtrl = cva(
  [
    "scroll-ctrl pointer-events-auto grid h-[30px] w-[30px] cursor-pointer place-items-center",
    "rounded-pill bg-paper-2 text-ink shadow-sm [border:var(--line-sm)]",
    "font-display text-[length:var(--text-13)] leading-none opacity-55",
    "[transition:opacity_160ms_ease,transform_80ms_ease,box-shadow_80ms_ease]",
    "hover:enabled:-translate-x-px hover:enabled:-translate-y-px hover:enabled:opacity-100 hover:enabled:shadow-hover",
    "disabled:cursor-default disabled:opacity-[0.18]",
  ],
  {
    variants: {
      newItems: {
        true: [
          "scroll-ctrl-new animate-[new-message-pop_900ms_ease-out_infinite] bg-lime opacity-100",
        ],
        false: null,
      },
    },
    defaultVariants: { newItems: false },
  },
);

interface ScrollControlsProps {
  targetRef: RefObject<HTMLElement | null>;
  newItemsKey?: string | number | null;
}

type Dir = "up" | "down" | null;

function maxScrollTop(el: HTMLElement): number {
  return Math.max(0, el.scrollHeight - el.clientHeight);
}

/**
 * Floating direction-aware accelerator pinned to the bottom-center of a
 * scrollable surface. Visibility is **tied to the scrollbar's visibility** so
 * the two always appear and disappear together — we observe the `.is-scrolling`
 * class that `useAutoScrollbar` adds to the same target. As long as that class
 * is present (the user is actively scrolling, or the auto-hide grace window
 * hasn't elapsed), the button matching the current scroll direction is shown.
 * When `.is-scrolling` is removed, the button hides — same beat as the
 * scrollbar fade.
 */
export function ScrollControls({ targetRef, newItemsKey = null }: ScrollControlsProps) {
  const [dir, setDir] = useState<Dir>(null);
  const [scrolling, setScrolling] = useState(false);
  const [atTop, setAtTop] = useState(true);
  const [atBottom, setAtBottom] = useState(true);
  const [hasNewBelow, setHasNewBelow] = useState(false);
  const lastTopRef = useRef(0);

  useEffect(() => {
    const el = targetRef.current;
    if (!el) return;
    lastTopRef.current = el.scrollTop;

    const updateExtents = () => {
      const nextAtTop = el.scrollTop <= 2;
      const nextAtBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 2;
      setAtTop(nextAtTop);
      setAtBottom(nextAtBottom);
      if (nextAtBottom) setHasNewBelow(false);
    };
    updateExtents();

    const onScroll = () => {
      const next = el.scrollTop;
      const prev = lastTopRef.current;
      if (next > prev + 1) setDir("down");
      else if (next < prev - 1) setDir("up");
      lastTopRef.current = next;
      updateExtents();
    };
    el.addEventListener("scroll", onScroll, { passive: true });

    const updateScrolling = () => setScrolling(el.classList.contains("is-scrolling"));
    updateScrolling();
    const co = new MutationObserver(updateScrolling);
    co.observe(el, { attributes: true, attributeFilter: ["class"] });

    const ro = new ResizeObserver(updateExtents);
    ro.observe(el);
    const mo = new MutationObserver(updateExtents);
    mo.observe(el, { childList: true, subtree: true, characterData: true });

    return () => {
      el.removeEventListener("scroll", onScroll);
      co.disconnect();
      ro.disconnect();
      mo.disconnect();
    };
  }, [targetRef]);

  useEffect(() => {
    const el = targetRef.current;
    if (!el || newItemsKey === null) return;
    const bottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 2;
    if (!bottom) {
      setDir("down");
      setAtBottom(false);
      setHasNewBelow(true);
    }
  }, [newItemsKey, targetRef]);

  // Visible only while the scrollbar's `.is-scrolling` window is active, AND
  // there's somewhere to scroll in the recorded direction.
  const visible: Dir =
    hasNewBelow && !atBottom            ? "down" :
    !scrolling                          ? null   :
    dir === "down" && !atBottom         ? "down" :
    dir === "up"   && !atTop            ? "up"   :
    null;

  if (!visible) return null;

  const jump = () => {
    const el = targetRef.current;
    if (!el) return;
    if (visible === "up") {
      el.scrollTo({ top: 0, behavior: "auto" });
      return;
    }
    setHasNewBelow(false);
    el.scrollTo({ top: maxScrollTop(el), behavior: "auto" });
  };

  return (
    <div
      className="pointer-events-none absolute bottom-[12px] left-1/2 z-[var(--z-scroll-controls)] flex -translate-x-1/2 flex-col gap-[var(--space-6)]"
      aria-hidden={false}
    >
      <button
        type="button"
        className={cn(scrollCtrl({ newItems: hasNewBelow && visible === "down" }))}
        onClick={jump}
        title={visible === "up" ? "scroll to top" : "scroll to bottom"}
        aria-label={visible === "up" ? "scroll to top" : "scroll to bottom"}
      >
        {visible === "up" ? "↑" : "↓"}
      </button>
    </div>
  );
}
