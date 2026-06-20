import { createContext, useContext } from "react";

// Shell breakpoints (see App.tsx shellModeForWidth): compact <780px, medium
// <1180px, desktop otherwise. Exposed via context so shared components
// (Composer, RoomHeader, …) can render compact-only variants without
// prop-drilling. Desktop/medium behaviour is unchanged when not consumed.
export type ShellMode = "desktop" | "medium" | "compact";

const ShellModeContext = createContext<ShellMode>("desktop");

export const ShellModeProvider = ShellModeContext.Provider;

export function useShellMode(): ShellMode {
  return useContext(ShellModeContext);
}

export function useIsCompact(): boolean {
  return useContext(ShellModeContext) === "compact";
}

// ── Shell layout contract ───────────────────────────────────────────────────
// The single source of truth mapping a ShellMode to layout CAPABILITIES. App
// and leaf components read named capabilities (`layout.bottomNav`) instead of
// re-deriving behavior from the raw mode (`mode === "compact"`). Adding a mode
// or changing a layout rule happens here, once. Medium is first-class — every
// capability is enumerated, not implicit fallthrough. (sync-imeu.1.10/1.13)
//
// NOTE: this is the LAYOUT axis (viewport width). The PLATFORM axis (web vs
// Capacitor/Android) is orthogonal and feature-detected separately — never fold
// the two together (an Android tablet is capacitor + medium/desktop, not
// compact).
export interface ShellLayout {
  mode: ShellMode;
  /** Persistent left room-list sidebar (desktop + medium). Compact uses the Chats overlay. */
  persistentSidebar: boolean;
  /** Thread opens as a resizable side-split with a header banner. Else it is a pushed full panel. */
  threadAsSplit: boolean;
  /** Persistent right roster column (when no thread is open). */
  rosterColumn: boolean;
  /** Roster is reachable as an overlay panel (AGENTS header button in medium, bottom-nav in compact). */
  rosterAsOverlay: boolean;
  /** Room switcher is the Chats overlay. */
  communityOverlay: boolean;
  /** Bottom navigation bar. */
  bottomNav: boolean;
  /** Timeline rail in chat. */
  timeline: boolean;
  /** Display settings presented as a bottom sheet. */
  settingsSheet: boolean;
}

export function shellLayout(mode: ShellMode): ShellLayout {
  return {
    mode,
    persistentSidebar: mode !== "compact",
    threadAsSplit: mode === "desktop",
    rosterColumn: mode === "desktop",
    rosterAsOverlay: mode !== "desktop",
    communityOverlay: mode === "compact",
    bottomNav: mode === "compact",
    timeline: mode !== "compact",
    settingsSheet: mode === "compact",
  };
}

export function useShellLayout(): ShellLayout {
  return shellLayout(useContext(ShellModeContext));
}
