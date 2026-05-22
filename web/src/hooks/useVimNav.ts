import { useCallback, useEffect, useRef, useState } from "react";
import { useHotkeys } from "react-hotkeys-hook";

export type VimPanel = "sidebar" | "chat" | "thread" | "roster";
export type VimMode = "navigate" | "typing";

interface UseVimNavConfig {
  /** Activate the currently focused item (Enter). Implementations decide what
   *  the action is per panel (switch room / open thread / toggle agent). */
  onActivate?(panel: VimPanel, itemId: string): void;
  /** Called when activePanel changes (so the host can decide what to highlight,
   *  e.g. on Escape from composer we want to land back on the chat panel). */
  onPanelChange?(panel: VimPanel): void;
  /** Close the given panel if it's closable (e.g. thread pane). Bound to `c`
   *  in navigate mode. Sidebar / chat / roster are not closable in v0. */
  onClosePanel?(panel: VimPanel): void;
  /** Whether the thread pane is currently mounted; tweaks the panel order. */
  threadOpen: boolean;
  /** Whether the roster column is mounted (hidden at narrow widths). */
  rosterVisible: boolean;
}

const PANEL_ATTR = "data-vim-panel";
const ITEM_ATTR = "data-vim-item";
// We track focus via a data attribute instead of a class because React owns
// className on most of our items (room-item gets `.active` toggled, etc.) and
// would clobber a class we set imperatively. Data attributes outside the React
// prop tree survive reconciliation.
const FOCUS_ATTR = "data-vim-focused";

function findPanel(panel: VimPanel): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[${PANEL_ATTR}="${panel}"]`);
}
function panelItems(panel: VimPanel): HTMLElement[] {
  const root = findPanel(panel);
  if (!root) return [];
  return Array.from(root.querySelectorAll<HTMLElement>(`[${ITEM_ATTR}]`));
}
function focusedItem(panel: VimPanel): HTMLElement | null {
  return findPanel(panel)?.querySelector<HTMLElement>(`[${FOCUS_ATTR}="true"]`) ?? null;
}

export function useVimNav({ onActivate, onPanelChange, onClosePanel, threadOpen, rosterVisible }: UseVimNavConfig) {
  const [mode, setMode] = useState<VimMode>("navigate");
  const [activePanel, setActivePanelState] = useState<VimPanel>("chat");
  const lastFocusedByPanel = useRef<Partial<Record<VimPanel, string>>>({});

  // Build the current panel order based on layout state. Roster and thread are
  // mutually exclusive in the current layout. Sidebar is always first.
  const order: VimPanel[] = ["sidebar", "chat"];
  if (threadOpen) order.push("thread");
  else if (rosterVisible) order.push("roster");

  const setActivePanel = useCallback(
    (next: VimPanel) => {
      if (!order.includes(next)) return;
      setActivePanelState(next);
      onPanelChange?.(next);
    },
    [order, onPanelChange],
  );

  // Apply or remove the focus class. Stores the id under lastFocusedByPanel so
  // subsequent J/K start from the same row when the user navigates away and
  // comes back. Scrolls the item into view smoothly, nearest.
  const setFocus = useCallback((panel: VimPanel, el: HTMLElement | null) => {
    // Always clear focus across ALL panels — there is exactly one navigation
    // cursor. Per-panel memory lives in `lastFocusedByPanel` so the previous
    // spot in each panel is restored on re-entry.
    document.querySelectorAll(`[${FOCUS_ATTR}="true"]`).forEach((n) => n.removeAttribute(FOCUS_ATTR));
    if (!el) return;
    el.setAttribute(FOCUS_ATTR, "true");
    const id = el.getAttribute(ITEM_ATTR);
    if (id) lastFocusedByPanel.current[panel] = id;
    el.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, []);

  // Snap focus to a sensible default whenever the user lands on a panel that
  // doesn't yet have a remembered focus. For chat we prefer the LAST message.
  const ensureFocus = useCallback(
    (panel: VimPanel) => {
      const items = panelItems(panel);
      if (items.length === 0) return;
      const remembered = lastFocusedByPanel.current[panel];
      const next = (remembered && items.find((el) => el.getAttribute(ITEM_ATTR) === remembered)) ?? null;
      if (next) {
        setFocus(panel, next);
        return;
      }
      // Defaults per panel.
      const def =
        panel === "chat" || panel === "thread" ? items[items.length - 1] :
        panel === "sidebar"                    ? items.find((el) => el.classList.contains("active")) ?? items[0] :
        items[0];
      setFocus(panel, def ?? null);
    },
    [setFocus],
  );

  // Whenever activePanel or its membership changes, make sure something is
  // focused inside the active panel. Cheap to run on every render.
  useEffect(() => {
    // If the current active panel just unmounted (e.g. thread closed while we
    // were inside it), fall back to chat — the always-present anchor.
    if (!order.includes(activePanel)) {
      setActivePanelState("chat");
      return;
    }
    if (mode !== "navigate") return;
    ensureFocus(activePanel);
  }, [activePanel, threadOpen, rosterVisible, mode, ensureFocus, order]);

  // Item navigation: J = next, K = previous, gg = first, G = last.
  const stepItem = useCallback(
    (delta: 1 | -1 | "top" | "bottom") => {
      const items = panelItems(activePanel);
      if (items.length === 0) return;
      const cur = focusedItem(activePanel);
      let nextIdx: number;
      if (delta === "top") nextIdx = 0;
      else if (delta === "bottom") nextIdx = items.length - 1;
      else {
        const curIdx = cur ? items.indexOf(cur) : -1;
        nextIdx = Math.max(0, Math.min(items.length - 1, (curIdx < 0 ? 0 : curIdx) + delta));
      }
      const target = items[nextIdx];
      if (target) setFocus(activePanel, target);
    },
    [activePanel, setFocus],
  );

  const stepPanel = useCallback(
    (delta: 1 | -1) => {
      const idx = order.indexOf(activePanel);
      if (idx === -1) return;
      const nextIdx = Math.max(0, Math.min(order.length - 1, idx + delta));
      const next = order[nextIdx];
      if (next && next !== activePanel) setActivePanel(next);
    },
    [order, activePanel, setActivePanel],
  );

  const activate = useCallback(() => {
    const el = focusedItem(activePanel);
    if (!el) return;
    const id = el.getAttribute(ITEM_ATTR);
    if (!id) return;
    onActivate?.(activePanel, id);
  }, [activePanel, onActivate]);

  // Sequence-tracking ref for the `gg` chord.
  const ggTimer = useRef<{ at: number } | null>(null);

  // Mode-gated bindings: only fire when mode === "navigate". Allow firing
  // inside the .resize-handle and similar interactive controls — but NEVER
  // inside textarea / input / contenteditable (default behavior of the lib).
  useHotkeys(
    "j",
    () => mode === "navigate" && stepItem(1),
    { preventDefault: true },
    [mode, stepItem],
  );
  useHotkeys(
    "k",
    () => mode === "navigate" && stepItem(-1),
    { preventDefault: true },
    [mode, stepItem],
  );
  useHotkeys(
    "shift+g",
    () => mode === "navigate" && stepItem("bottom"),
    { preventDefault: true },
    [mode, stepItem],
  );
  useHotkeys(
    "g",
    () => {
      if (mode !== "navigate") return;
      const now = Date.now();
      if (ggTimer.current && now - ggTimer.current.at < 500) {
        stepItem("top");
        ggTimer.current = null;
      } else {
        ggTimer.current = { at: now };
      }
    },
    { preventDefault: true },
    [mode, stepItem],
  );

  useHotkeys(
    "l, tab",
    (e) => {
      if (mode !== "navigate") return;
      e.preventDefault();
      stepPanel(1);
    },
    { preventDefault: true },
    [mode, stepPanel],
  );
  useHotkeys(
    "h, shift+tab",
    (e) => {
      if (mode !== "navigate") return;
      e.preventDefault();
      stepPanel(-1);
    },
    { preventDefault: true },
    [mode, stepPanel],
  );

  useHotkeys(
    "enter",
    () => mode === "navigate" && activate(),
    { preventDefault: true },
    [mode, activate],
  );

  useHotkeys(
    "i",
    () => {
      if (mode !== "navigate") return;
      // Route to the composer that belongs to the ACTIVE panel — not whichever
      // textarea was focused last. Sidebar / roster fall back to chat.
      const target: VimPanel = activePanel === "thread" ? "thread" : "chat";
      const panel = findPanel(target);
      const ta = panel?.querySelector<HTMLTextAreaElement>(".composer-input");
      if (ta) {
        ta.focus();
      } else {
        // Composer is collapsed; expanding the stub focuses the textarea.
        panel?.querySelector<HTMLButtonElement>(".composer-collapsed-stub")?.click();
      }
    },
    { preventDefault: true },
    [mode, activePanel],
  );

  // `c` closes the active panel if a close handler is provided for it (used by
  // the thread pane). No-op for sidebar / chat / roster.
  useHotkeys(
    "c",
    () => {
      if (mode !== "navigate") return;
      onClosePanel?.(activePanel);
    },
    { preventDefault: true },
    [mode, activePanel, onClosePanel],
  );

  // Escape behavior: if typing, blur the textarea (its onBlur flips us to
  // navigate). If already navigating, drop active panel back to chat.
  useHotkeys(
    "escape",
    () => {
      const ae = document.activeElement as HTMLElement | null;
      if (ae && ae.tagName === "TEXTAREA") {
        ae.blur();
        return;
      }
      if (mode === "navigate" && activePanel !== "chat") {
        setActivePanel("chat");
      }
    },
    { enableOnFormTags: ["textarea", "input"], preventDefault: true },
    [mode, activePanel, setActivePanel],
  );

  return {
    mode,
    setMode,
    activePanel,
    setActivePanel,
  };
}
