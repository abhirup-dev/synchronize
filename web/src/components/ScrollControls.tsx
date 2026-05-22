import { useEffect, useRef, useState, type RefObject } from "react";

interface ScrollControlsProps {
  targetRef: RefObject<HTMLElement | null>;
}

type Dir = "up" | "down" | null;

/**
 * Floating direction-aware accelerator pinned to the bottom-right of a
 * scrollable surface. Visibility is **tied to the scrollbar's visibility** so
 * the two always appear and disappear together — we observe the `.is-scrolling`
 * class that `useAutoScrollbar` adds to the same target. As long as that class
 * is present (the user is actively scrolling, or the auto-hide grace window
 * hasn't elapsed), the button matching the current scroll direction is shown.
 * When `.is-scrolling` is removed, the button hides — same beat as the
 * scrollbar fade.
 */
export function ScrollControls({ targetRef }: ScrollControlsProps) {
  const [dir, setDir] = useState<Dir>(null);
  const [scrolling, setScrolling] = useState(false);
  const [atTop, setAtTop] = useState(true);
  const [atBottom, setAtBottom] = useState(true);
  const lastTopRef = useRef(0);

  useEffect(() => {
    const el = targetRef.current;
    if (!el) return;
    lastTopRef.current = el.scrollTop;

    const updateExtents = () => {
      setAtTop(el.scrollTop <= 2);
      setAtBottom(el.scrollTop + el.clientHeight >= el.scrollHeight - 2);
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

  // Visible only while the scrollbar's `.is-scrolling` window is active, AND
  // there's somewhere to scroll in the recorded direction.
  const visible: Dir =
    !scrolling                          ? null   :
    dir === "down" && !atBottom         ? "down" :
    dir === "up"   && !atTop            ? "up"   :
    null;

  if (!visible) return null;

  const jump = () => {
    const el = targetRef.current;
    if (!el) return;
    el.scrollTo({ top: visible === "up" ? 0 : el.scrollHeight, behavior: "smooth" });
  };

  return (
    <div className="scroll-controls" aria-hidden={false}>
      <button
        type="button"
        className="scroll-ctrl"
        onClick={jump}
        title={visible === "up" ? "scroll to top" : "scroll to bottom"}
        aria-label={visible === "up" ? "scroll to top" : "scroll to bottom"}
      >
        {visible === "up" ? "↑" : "↓"}
      </button>
    </div>
  );
}
