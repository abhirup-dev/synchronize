import { Outlet, useSearch } from "@tanstack/react-router";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useAgents, useMessages, useRooms } from "../data/context.tsx";
import { AgentRoster } from "../components/AgentRoster.tsx";
import { BottomNav } from "../components/BottomNav.tsx";
import { Sidebar } from "../components/Sidebar.tsx";
import { useToast } from "../components/Toast.tsx";
import { roomAgent } from "../data/roomAgents.ts";
import { useShellNavigation } from "../hooks/useShellNavigation.ts";
import { useThreadWidth } from "../hooks/useThreadWidth.ts";
import { cycleTheme, toggleThemeFamily, usePersistentTheme } from "../hooks/usePersistentTheme.ts";
import { useVimNav, type VimPanel } from "../hooks/useVimNav.ts";
import {
  ACTIVITY_ROOM_ID,
  useActiveRoomId,
  useIsActivityRoute,
  useIsThreadRoute,
  useNavigateToRoom,
  useNavigateToThread,
} from "../routing/router.tsx";
import { AppShellGrid, ShellMainColumn } from "../shell-layout.tsx";
import { shellLayout, shellModeForWidth, type ShellMode } from "../shell-mode.tsx";
import { CompactAppBar, CompactSettingsSheet } from "./compact-chrome.tsx";
import { ShellChromeProvider, type ShellChromeApi } from "./chrome-context.tsx";

/**
 * The one layout route. It owns the chrome-wide state (appearance, thread split
 * width, compact overlays, vim mode) and renders the matched surface through
 * <Outlet/>.
 *
 * ?view=pane selects bare chrome. The branch is here and only here: one set of
 * leaf routes under one layout, so adding an addressable surface does not add a
 * second chrome variant to write.
 */
export function AppLayout() {
  const { view } = useSearch({ strict: false }) as { view?: "pane" };
  const rooms = useRooms();
  const agents = useAgents();
  const toast = useToast();
  const activeRoomId = useActiveRoomId();
  const isActivity = useIsActivityRoute();
  const goToRoom = useNavigateToRoom();
  const goToThread = useNavigateToThread();
  const room = rooms.find((candidate) => candidate.id === activeRoomId);
  const roomMessages = useMessages(activeRoomId ?? "");

  const [shellMode, setShellMode] = useState<ShellMode>(() => shellModeForWidth(window.innerWidth));
  useEffect(() => {
    const onResize = () => setShellMode(shellModeForWidth(window.innerWidth));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  const layout = shellLayout(shellMode);

  const { theme, setTheme, skin, setSkin, chatBg, setChatBg } = usePersistentTheme();
  const [threadWidth, setThreadWidth] = useThreadWidth();

  // Last real room visited, so the compact "Chats" tab can restore a
  // conversation when leaving the (virtual) Activity destination.
  const lastRoomIdRef = useRef<string>("");
  if (activeRoomId) lastRoomIdRef.current = activeRoomId;

  const nav = useShellNavigation({
    shellMode,
    isActivity,
    goToRoom,
    goToActivity: () => goToRoom(ACTIVITY_ROOM_ID),
    lastRoomIdRef,
  });

  const openDmForAgent = (agentId: string) => {
    const dm = rooms.find((candidate) => candidate.kind === "dm" && candidate.peerId === agentId);
    if (!dm) {
      toast.show(`No direct message for ${agents.find((candidate) => candidate.id === agentId)?.name ?? "this agent"}`, { kind: "info" });
      return;
    }
    goToRoom(dm.id);
  };

  // Jump-to-last-message-by-agent: scroll to the agent's latest message in the
  // active room and flash it, or toast when the agent has not posted there.
  const jumpToAgentLast = (agentId: string) => {
    if (!room) return;
    const globalAgent = agents.find((candidate) => candidate.id === agentId);
    const agent = globalAgent ? roomAgent(globalAgent, room) : undefined;
    const last = [...roomMessages].reverse().find((message) => message.authorId === agentId);
    if (!last) {
      toast.show(
        `${agent?.name ?? "this agent"} has not posted in ${room.kind === "group" ? `#${room.name}` : room.name} yet`,
        { kind: "info" },
      );
      return;
    }
    flashMessage(last.id);
  };

  // Vim navigation — panel cycle, item navigation, activation, insert, Escape.
  const onActivate = (panel: VimPanel, itemId: string) => {
    if (panel === "sidebar") goToRoom(itemId.replace(/^room-/, ""));
    else if (panel === "chat") goToThread(itemId.replace(/^msg-/, ""));
    else if (panel === "roster") jumpToAgentLast(itemId.replace(/^agent-/, ""));
  };
  const threadOpen = useIsThreadRoute();
  const vim = useVimNav({
    onActivate,
    onClosePanel: (panel) => {
      if (panel === "thread" && activeRoomId) goToRoom(activeRoomId);
    },
    threadOpen,
    rosterVisible: !threadOpen,
  });
  // Mode auto-switch: any textarea/input focus → typing; blur → navigate.
  // Centralized here so individual components stay mode-agnostic.
  useEffect(() => {
    const isEditable = (el: EventTarget | null) =>
      el instanceof HTMLElement && (el.tagName === "TEXTAREA" || el.tagName === "INPUT" || el.isContentEditable);
    const onFocusIn = (event: FocusEvent) => isEditable(event.target) && vim.setMode("typing");
    const onFocusOut = (event: FocusEvent) => {
      if (!isEditable(event.target)) return;
      window.setTimeout(() => {
        if (!document.hasFocus()) return;
        vim.setMode("navigate");
      }, 0);
    };
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    return () => {
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
    };
  }, [vim]);

  // Rebuilt every render on purpose: the callbacks close over the current room
  // and its messages, and this component re-renders whenever those change.
  const chrome: ShellChromeApi = {
    theme,
    setTheme,
    skin,
    setSkin,
    chatBg,
    setChatBg,
    threadWidth,
    setThreadWidth,
    openCommunity: nav.openCommunity,
    openAgents: nav.openAgents,
    openCompactSettings: nav.openCompactSettings,
    jumpToAgentLast,
    openDmForAgent,
  };

  if (view === "pane") {
    // A pane is embedded in another window's chrome, so it carries none of its
    // own — no rail, no room list, no bottom nav.
    return (
      <ShellChromeProvider value={chrome}>
        <AppShellGrid mode={shellMode} data-shell-view="pane" data-vim-mode={vim.mode}>
          <ShellMainColumn>
            <Outlet />
          </ShellMainColumn>
        </AppShellGrid>
      </ShellChromeProvider>
    );
  }

  return (
    <ShellChromeProvider value={chrome}>
      <AppShellGrid mode={shellMode} threadOpen={threadOpen} data-vim-mode={vim.mode}>
        {layout.persistentSidebar && (
          <Sidebar
            activeRoomId={isActivity ? ACTIVITY_ROOM_ID : (room?.id ?? "")}
            onSelect={nav.selectRoom}
            mode={vim.mode}
            displaySettings={{
              theme,
              skin,
              chatBg,
              onTheme: setTheme,
              onToggleSkin: () => setSkin((current) => (current === "brutal" ? "glass" : "brutal")),
              onChatBg: setChatBg,
            }}
          />
        )}
        <ShellMainColumn
          style={threadOpen && layout.threadAsSplit ? ({ "--thread-pane-width": `${threadWidth}px` } as CSSProperties) : undefined}
        >
          <Outlet />
        </ShellMainColumn>
        {layout.communityOverlay && nav.communityOpen && (
          <div
            className="shell-overlay shell-overlay-community fixed z-[var(--z-modal)] bg-paper text-ink [border:var(--line)] shadow-lg flex flex-col overflow-hidden"
            role="dialog"
            aria-modal="true"
            aria-label="chats"
          >
            <CompactAppBar
              title="Chats"
              detail={`${rooms.length} rooms`}
              onSettings={nav.openCompactSettings}
              onClose={nav.closeOverlays}
            />
            <Sidebar activeRoomId={room?.id ?? ""} onSelect={nav.selectRoom} mode={vim.mode} />
          </div>
        )}
        {layout.rosterAsOverlay && !threadOpen && nav.agentPanelOpen && room && (
          <div
            className={`shell-overlay shell-overlay-agents shell-overlay-${shellMode} fixed z-[var(--z-modal)] bg-paper text-ink [border:var(--line)] shadow-lg flex flex-col overflow-hidden`}
            role="dialog"
            aria-modal="true"
            aria-label="agents"
          >
            <CompactAppBar
              title="Agents"
              detail={`${room.members.length} in ${room.kind === "group" ? `#${room.name}` : room.name}`}
              onSettings={nav.openCompactSettings}
              onClose={nav.closeOverlays}
            />
            <AgentRoster room={room} onAgentDoubleClick={jumpToAgentLast} onOpenDm={openDmForAgent} />
          </div>
        )}
        {layout.bottomNav && (
          <BottomNav
            active={nav.bottomNavTab}
            onChats={nav.onNavChats}
            onActivity={nav.onNavActivity}
            onAgents={nav.onNavAgents}
            agentCount={room?.members.length ?? 0}
          />
        )}
        {layout.settingsSheet && (
          <CompactSettingsSheet
            open={nav.compactSettingsOpen}
            theme={theme}
            skin={skin}
            chatBg={chatBg}
            onToggleAppearance={() => setTheme((current) => toggleThemeFamily(current))}
            onCycleTheme={() => setTheme((current) => cycleTheme(current))}
            onToggleSkin={() => setSkin((current) => (current === "brutal" ? "glass" : "brutal"))}
            onChatBg={setChatBg}
            onClose={nav.closeCompactSettings}
          />
        )}
      </AppShellGrid>
    </ShellChromeProvider>
  );
}

/** Scroll a message into view and flash the deep-link highlight on it. */
export function flashMessage(messageId: string): void {
  const el = document.getElementById(`msg-${messageId}`);
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  el.classList.add("flash-highlight");
  window.setTimeout(() => el.classList.remove("flash-highlight"), 2400);
}
