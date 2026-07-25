import { createContext, useContext, type Dispatch, type MouseEvent as ReactMouseEvent, type SetStateAction } from "react";
import type { ThemeName } from "../hooks/usePersistentTheme.ts";

/**
 * Chrome-owned state that route leaves need to read or drive: appearance, the
 * thread split width, the compact overlays, and the two cross-surface jumps.
 *
 * It exists because these are single-instance concerns — one theme, one split
 * width, one open overlay — while the surface that reads them changes with the
 * route. Anything scoped to a single surface stays local to that leaf.
 */
export interface ShellChromeApi {
  /** This window is an embedded pane: no chrome, and no shell-only affordances
   *  such as the desktop thread split — a popped-out thread IS the surface. */
  pane: boolean;
  theme: ThemeName;
  setTheme: Dispatch<SetStateAction<ThemeName>>;
  skin: "brutal" | "glass";
  setSkin: Dispatch<SetStateAction<"brutal" | "glass">>;
  chatBg: string;
  setChatBg: (id: string) => void;
  threadWidth: number;
  setThreadWidth: (width: number) => void;
  /** No-ops under pane chrome, which has no overlays to open. */
  openCommunity: () => void;
  openAgents: () => void;
  openCompactSettings: (event: ReactMouseEvent) => void;
  /** Scroll to an agent's last message in the active room, or toast if it has none. */
  jumpToAgentLast: (agentId: string) => void;
  /** Navigate to the DM with an agent, or toast if there is none. */
  openDmForAgent: (agentId: string) => void;
}

const Ctx = createContext<ShellChromeApi | null>(null);

export const ShellChromeProvider = Ctx.Provider;

export function useShellChrome(): ShellChromeApi {
  const api = useContext(Ctx);
  if (!api) throw new Error("ShellChromeProvider missing in tree");
  return api;
}
