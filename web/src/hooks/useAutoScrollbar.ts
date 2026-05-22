import { useEffect, useRef } from "react";

/**
 * Adds an `is-scrolling` class to the returned ref'd element while the user is
 * actively scrolling it. Class is removed after `idleMs` of no scroll activity.
 * CSS keys off `.is-scrolling` to fade the thumb in; otherwise it stays
 * transparent so the rail visually disappears at rest.
 */
export function useAutoScrollbar<T extends HTMLElement>(idleMs = 800) {
  const ref = useRef<T | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let timer: number | undefined;
    const onScroll = () => {
      el.classList.add("is-scrolling");
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => el.classList.remove("is-scrolling"), idleMs);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      if (timer) window.clearTimeout(timer);
    };
  }, [idleMs]);

  return ref;
}
