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
