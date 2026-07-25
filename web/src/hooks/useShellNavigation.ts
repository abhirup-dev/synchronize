import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type RefObject } from "react";
import type { BottomNavTab } from "../components/BottomNav.tsx";
import { shellLayout, type ShellMode } from "../shell-mode.tsx";

interface ShellNavigationOptions {
  shellMode: ShellMode;
  isActivity: boolean;
  /** Router navigation, so this hook never spells an address. */
  goToRoom: (roomId: string) => void;
  goToActivity: () => void;
  /** Last real room visited, so "Chats"/"Agents" can restore a conversation when
   *  leaving the Activity feed. Owned by the layout. */
  lastRoomIdRef: RefObject<string>;
}

/**
 * Owns the compact navigation/overlay surface: the Chats and Agents panels, the
 * display-settings sheet, bottom-nav routing, focus restore, and the resize/Escape
 * effects that close them. Extracted from App so the Shell is composition rather
 * than overlay plumbing, and so this mode-specific logic stops leaking through App
 * and child props (sync-imeu.1.4). The route tree keeps core routing.
 */
export function useShellNavigation({ shellMode, isActivity, goToRoom, goToActivity, lastRoomIdRef }: ShellNavigationOptions) {
  const [communityOpen, setCommunityOpen] = useState(false);
  const [agentPanelOpen, setAgentPanelOpen] = useState(false);
  const [compactSettingsOpen, setCompactSettingsOpen] = useState(false);
  // The control to return focus to when an overlay closes (the trigger).
  const overlayRestoreRef = useRef<HTMLElement | null>(null);

  const rememberOverlayOpener = () => {
    overlayRestoreRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  };
  const closeOverlays = () => {
    setCommunityOpen(false);
    setAgentPanelOpen(false);
    queueMicrotask(() => overlayRestoreRef.current?.focus());
  };
  const openCommunity = () => {
    rememberOverlayOpener();
    setCommunityOpen(true);
  };
  const openAgents = () => {
    rememberOverlayOpener();
    setAgentPanelOpen(true);
  };
  const openCompactSettings = (event: ReactMouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    rememberOverlayOpener();
    setCompactSettingsOpen(true);
  };
  const closeCompactSettings = () => setCompactSettingsOpen(false);
  const selectRoom = (id: string) => {
    goToRoom(id);
    setCommunityOpen(false);
    setAgentPanelOpen(false);
  };

  // Compact bottom-nav destinations. Chats = the conversation section: tapping it
  // opens the room switcher (restoring a conversation first if we were in
  // Activity). Activity = the virtual cross-room feed. Agents = the roster sheet.
  const bottomNavTab: BottomNavTab = isActivity ? "activity" : agentPanelOpen ? "agents" : "chats";
  const onNavChats = () => {
    setAgentPanelOpen(false);
    if (isActivity) goToRoom(lastRoomIdRef.current);
    rememberOverlayOpener();
    setCommunityOpen(true);
  };
  const onNavActivity = () => {
    setCommunityOpen(false);
    setAgentPanelOpen(false);
    goToActivity();
  };
  const onNavAgents = () => {
    setCommunityOpen(false);
    if (isActivity) goToRoom(lastRoomIdRef.current);
    rememberOverlayOpener();
    setAgentPanelOpen(true);
  };

  // Close mode-specific surfaces when a resize crosses into a mode that no longer
  // offers them (capabilities, not raw mode).
  useEffect(() => {
    const l = shellLayout(shellMode);
    if (!l.communityOverlay) setCommunityOpen(false);
    if (!l.settingsSheet) setCompactSettingsOpen(false);
    if (!l.rosterAsOverlay) setAgentPanelOpen(false);
  }, [shellMode]);

  // Escape for the non-modal Chats/Agents panels. (The display settings sheet is
  // a Base UI Dialog and handles its own Escape + focus restore.)
  useEffect(() => {
    if (!communityOpen && !agentPanelOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setCommunityOpen(false);
      setAgentPanelOpen(false);
      queueMicrotask(() => overlayRestoreRef.current?.focus());
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [communityOpen, agentPanelOpen]);

  return {
    communityOpen,
    agentPanelOpen,
    compactSettingsOpen,
    closeOverlays,
    openCommunity,
    openAgents,
    openCompactSettings,
    closeCompactSettings,
    selectRoom,
    onNavChats,
    onNavActivity,
    onNavAgents,
    bottomNavTab,
  };
}
