import type { CSSProperties } from "react";

/**
 * Grid template for the desktop thread split, shared by the room and thread
 * layouts.
 *
 * Its own module because React Fast Refresh only accepts a module whose exports
 * are all components: a helper exported alongside one invalidates the module and
 * Vite falls back to a full page reload for every edit to it.
 */
export function threadSplitStyle(threadWidth: number): CSSProperties {
  return {
    gridTemplateColumns: `minmax(0, 1fr) ${threadWidth}px`,
    "--thread-pane-width": `${threadWidth}px`,
  } as CSSProperties;
}

/** Scroll a message into view and flash the deep-link highlight on it. */
export function flashMessage(messageId: string): void {
  const el = document.getElementById(`msg-${messageId}`);
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  el.classList.add("flash-highlight");
  window.setTimeout(() => el.classList.remove("flash-highlight"), 2400);
}
