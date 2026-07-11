import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from "react";
import { Settings, X } from "lucide-react";
import type { DataSource, WebDeepLinkTarget } from "./data/types.ts";
import { DataSourceProvider, useDataSource, useRooms, useMessages, useAgents } from "./data/context.tsx";
import { deepLinkPath, parseDeepLinkId } from "./deeplinks.ts";
import { MockDataSource } from "./data/mock.ts";
import { CHAT_BACKGROUNDS } from "./data/chatBackgrounds.ts";
import { DaemonDataSource } from "./data/daemon.ts";
import { Sidebar } from "./components/Sidebar.tsx";
import { RoomHeader, type RoomTab } from "./components/RoomHeader.tsx";
import { ChatView } from "./components/ChatView.tsx";
import { BoardView } from "./components/BoardView.tsx";
import { AgentRoster } from "./components/AgentRoster.tsx";
import { ContextMenuProvider } from "./components/ContextMenu.tsx";
import { ThreadPane } from "./components/ThreadPane.tsx";
import { ResizeHandle } from "./components/ResizeHandle.tsx";
import { ActivityView } from "./components/ActivityView.tsx";
import { BottomNav } from "./components/BottomNav.tsx";
import { ArchiveRecoveryProvider } from "./components/ArchiveRecovery.tsx";
import { useVimNav, type VimPanel } from "./hooks/useVimNav.ts";
import { ToastProvider, useToast } from "./components/Toast.tsx";
import { roomAgent } from "./data/roomAgents.ts";
import { shellLayout, shellModeForWidth, type ShellMode } from "./shell-mode.tsx";
import { AppShellGrid, ShellMainColumn, ShellMainBody, ShellChatColumn } from "./shell-layout.tsx";
import { IconButton } from "./components/IconButton.tsx";
import { Sheet } from "./ui/Sheet.tsx";
import { usePersistentTheme, type ThemeName, themeFamily, cycleTheme, toggleThemeFamily } from "./hooks/usePersistentTheme.ts";
import { useShellNavigation } from "./hooks/useShellNavigation.ts";
// Dev-only live token editor — EXCLUDED from production builds. web/build.ts
// replaces process.env.NODE_ENV at build time ("production" unless --watch), so in
// a prod build this ternary folds to null and the dynamic import() is dead-code
// eliminated — the editor never ships, rather than being merely hidden behind a flag.
const ThemeTokenEditor =
  process.env.NODE_ENV !== "production"
    ? lazy(() => import("./theme/ThemeTokenEditor.tsx").then((m) => ({ default: m.ThemeTokenEditor })))
    : null;

function titleCase(value: string): string {
  return value
    .split(/[-_ ]+/)
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}

function pickDataSource(): DataSource {
  if (localStorage.getItem("SYNCHRONIZE_DATA_SOURCE") === "mock") {
    return new MockDataSource();
  }
  const token =
    sessionStorage.getItem("SYNCHRONIZE_TOKEN") ??
    localStorage.getItem("SYNCHRONIZE_TOKEN") ??
    undefined;
  if (localStorage.getItem("SYNCHRONIZE_DATA_SOURCE") === "live" || window.location.pathname.startsWith("/web")) {
    return new DaemonDataSource(token ? { token } : {});
  }
  return new MockDataSource();
}

export function App() {
  const ds = useMemo(pickDataSource, []);
  const [connectError, setConnectError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void ds.connect().then(
      () => !cancelled && setConnectError(null),
      (error) => !cancelled && setConnectError(error instanceof Error ? error.message : String(error)),
    );
    return () => ds.disconnect();
  }, [ds]);
  if (connectError) {
    return <ConnectionError message={connectError} />;
  }
  return (
    <DataSourceProvider value={ds}>
      <ContextMenuProvider>
        <ToastProvider>
          <ArchiveRecoveryProvider>
            <Shell />
            {ThemeTokenEditor && (
              <Suspense fallback={null}>
                <ThemeTokenEditor />
              </Suspense>
            )}
          </ArchiveRecoveryProvider>
        </ToastProvider>
      </ContextMenuProvider>
    </DataSourceProvider>
  );
}

// Exported for Storybook (Surfaces/ConnectionError). App() is the runtime caller.
export function ConnectionError({ message }: { message: string }) {
  const authHint = message.toLowerCase().includes("unauthorized") || message.includes("401");
  return (
    <div className="connection-error">
      <div className="connection-error-box">
        <div className="brand-mark">S</div>
        <h1>Daemon connection failed</h1>
        <p>{message}</p>
        {authHint && (
          <p>
            Protected daemon mode needs `SYNCHRONIZE_TOKEN` in sessionStorage or localStorage before loading `/web`.
          </p>
        )}
      </div>
    </div>
  );
}

const ACTIVITY_ID = "activity";

// Exported so Storybook can mount the full app shell for cross-component flow
// tests (e.g. activity → open thread → scroll). App() is the only other caller.
export function Shell() {
  const rooms = useRooms();
  // Land on the first room as before; the sidebar's Activity item is the entry
  // point. Fall back to Activity only when there are no rooms yet (more useful
  // than an empty "no rooms" pane).
  const ds = useDataSource();
  const [activeId, setActiveId] = useState<string>(rooms[0]?.id ?? ACTIVITY_ID);
  const [tab, setTab] = useState<RoomTab>("chat");
  const [threadParentId, setThreadParentId] = useState<string | null>(null);
  // Deep-link target waiting to be applied once its room window has hydrated, and
  // the message id the chat/thread surface should scroll to and flash.
  const [pendingDeepLink, setPendingDeepLink] = useState<WebDeepLinkTarget | null>(null);
  const [focusMessageId, setFocusMessageId] = useState<string | null>(null);
  const [shellMode, setShellMode] = useState<ShellMode>(() => shellModeForWidth(window.innerWidth));
  // Last real room visited, so the compact "Chats" tab can restore a
  // conversation when leaving the (virtual) Activity destination.
  const lastRoomIdRef = useRef<string>(rooms[0]?.id ?? "");
  const [threadSummaryOpen, setThreadSummaryOpen] = useState(false);
  const [threadWidth, setThreadWidth] = useState<number>(() => {
    const stored = Number(localStorage.getItem("synchronize.threadWidth"));
    return Number.isFinite(stored) && stored >= 320 && stored <= 820 ? stored : 420;
  });
  useEffect(() => {
    localStorage.setItem("synchronize.threadWidth", String(threadWidth));
  }, [threadWidth]);
  const { theme, setTheme, skin, setSkin, chatBg, setChatBg } = usePersistentTheme();

  const isActivity = activeId === ACTIVITY_ID;
  if (!isActivity && activeId) lastRoomIdRef.current = activeId;

  const {
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
  } = useShellNavigation({ shellMode, isActivity, setActiveId, activityId: ACTIVITY_ID, lastRoomIdRef });

  useEffect(() => {
    // "activity" is a virtual destination, not a room — never reset it away.
    if (activeId === ACTIVITY_ID) return;
    if (!activeId && rooms[0]) setActiveId(rooms[0].id);
    if (activeId && rooms.length > 0 && !rooms.some((candidate) => candidate.id === activeId)) {
      setActiveId(rooms[0]?.id ?? "");
    }
  }, [activeId, rooms]);

  // Jump from the Activity feed into a room, optionally scrolling to a message.
  const jumpToRoom = (roomId: string, msgId?: string) => {
    setActiveId(roomId);
    setTab("chat");
    if (!msgId) return;
    window.setTimeout(() => {
      const el = document.getElementById(`msg-${msgId}`);
      if (!el) return;
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.add("flash-highlight");
      window.setTimeout(() => el.classList.remove("flash-highlight"), 2400);
    }, 320);
  };

  useEffect(() => {
    const onResize = () => setShellMode(shellModeForWidth(window.innerWidth));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Read the URL, resolve + hydrate the target, then switch rooms. The actual
  // focus/thread-open is deferred to the apply effect below, which waits for the
  // hydrated messages to land. Runs on mount and on browser back/forward.
  const loadDeepLinkFromUrl = useCallback(async () => {
    const id = parseDeepLinkId();
    if (!id) return;
    try {
      const target = await ds.resolveDeepLink(id);
      await ds.hydrateDeepLinkTarget(target);
      setActiveId(target.roomId);
      setPendingDeepLink(target);
    } catch {
      // Unknown or unauthorized link — leave the user on the default room.
    }
  }, [ds]);

  useEffect(() => {
    void loadDeepLinkFromUrl();
  }, [loadDeepLinkFromUrl]);

  useEffect(() => {
    const onPop = () => void loadDeepLinkFromUrl();
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [loadDeepLinkFromUrl]);

  // Reset secondary state when switching rooms. NOTE: agentPanelOpen is
  // deliberately NOT reset here — the compact "Agents" tab leaves the Activity
  // feed by setting a room AND opening the roster in the same render, so
  // clobbering it here would defeat that nav. Closing on an explicit room pick
  // is handled in selectRoom instead.
  useEffect(() => {
    setTab("chat");
    setThreadParentId(null);
    setThreadSummaryOpen(false);
    setFocusMessageId(null);
  }, [activeId]);

  const room = rooms.find((r) => r.id === activeId) ?? rooms[0];
  const roomMessages = useMessages(room?.id ?? "");
  const agents = useAgents();
  const toast = useToast();
  const openDmForAgent = (agentId: string) => {
    const dm = rooms.find((candidate) => candidate.kind === "dm" && candidate.peerId === agentId);
    if (!dm) {
      const agent = agents.find((candidate) => candidate.id === agentId);
      toast.show(`No direct message for ${agent?.name ?? "this agent"}`, { kind: "info" });
      return;
    }
    jumpToRoom(dm.id);
  };

  // Apply a pending deep link once its room is active and the target message has
  // hydrated. Declared after the room-reset effect so, on the activeId change it
  // triggers, the reset runs first and this re-applies on top. Waits (re-running
  // as roomMessages arrive) until the target — or, for a thread, its parent — is
  // present, so the focus/scroll actually lands.
  useEffect(() => {
    const target = pendingDeepLink;
    if (!target || activeId !== target.roomId) return;
    if (target.surface === "group-thread" && target.threadParentId) {
      if (!roomMessages.some((message) => message.id === target.threadParentId)) return;
      setThreadParentId(target.threadParentId);
    } else if (!roomMessages.some((message) => message.id === target.focusMessageId)) {
      return;
    }
    setFocusMessageId(target.focusMessageId);
    setPendingDeepLink(null);
    // Normalize the address bar to the canonical /web/e/:id form without adding a
    // history entry, so a refresh re-lands on the same target.
    window.history.replaceState(null, "", deepLinkPath(target));
  }, [pendingDeepLink, activeId, roomMessages]);
  const threadParent = threadParentId ? roomMessages.find((message) => message.id === threadParentId) : undefined;
  const threadAuthor = threadParent && room
    ? agents.find((agent) => agent.id === threadParent.authorId)
    : undefined;
  const displayThreadAuthor = threadAuthor && room ? roomAgent(threadAuthor, room) : undefined;
  const layout = shellLayout(shellMode);
  const rosterPersistent = layout.rosterColumn && !threadParentId;
  const rosterPanelAvailable = layout.rosterAsOverlay && !threadParentId;
  const communityPanelAvailable = layout.communityOverlay;
  const pushedThreadOpen = Boolean(threadParentId && !layout.threadAsSplit);

  // Android hardware Back: close the top open surface before letting the OS
  // exit the app. Reaches Capacitor's runtime via its injected global so the
  // shared web bundle needs no @capacitor/app dependency — inert in the browser
  // (the plugin is absent), active only inside the Capacitor WebView (APK).
  useEffect(() => {
    const cap = (window as unknown as {
      Capacitor?: { Plugins?: { App?: { addListener?(e: string, cb: () => void): Promise<{ remove(): void }>; exitApp?(): void } } };
    }).Capacitor;
    const app = cap?.Plugins?.App;
    if (!app?.addListener) return;
    const sub = app.addListener("backButton", () => {
      if (compactSettingsOpen) closeCompactSettings();
      else if (agentPanelOpen || communityOpen) closeOverlays();
      else if (threadParentId) setThreadParentId(null);
      else app.exitApp?.();
    });
    return () => { void sub.then((handle) => handle.remove()); };
  }, [compactSettingsOpen, agentPanelOpen, communityOpen, threadParentId]);

  // Jump-to-last-message-by-agent: scrolls to the latest message authored by
  // `agentId` in the active room, flashes it with the throbbing yellow ring.
  // If the agent has no messages in this room, fire a toast.
  const jumpToAgentLast = (agentId: string) => {
    if (!room) return;
    const globalAgent = agents.find((a) => a.id === agentId);
    const agent = globalAgent ? roomAgent(globalAgent, room) : undefined;
    const last = [...roomMessages].reverse().find((m) => m.authorId === agentId);
    if (!last) {
      toast.show(
        `${agent?.name ?? "this agent"} has not posted in ${room.kind === "group" ? `#${room.name}` : room.name} yet`,
        { kind: "info" },
      );
      return;
    }
    const el = document.getElementById(`msg-${last.id}`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.add("flash-highlight");
    window.setTimeout(() => el.classList.remove("flash-highlight"), 2400);
  };

  // Vim navigation — modes (navigate / typing), panel cycle (H/L/Tab),
  // item navigation (J/K/gg/G), activation (Enter), insert (i), Escape.
  const onActivate = (panel: VimPanel, itemId: string) => {
    if (panel === "sidebar") {
      // itemId is like "room-{id}". Strip the prefix and switch rooms.
      const id = itemId.replace(/^room-/, "");
      setActiveId(id);
    } else if (panel === "chat") {
      // itemId is "msg-{id}". Open thread on that message.
      const mid = itemId.replace(/^msg-/, "");
      setThreadParentId(mid);
    } else if (panel === "roster") {
      // Enter on a roster card = "take me to their last message".
      const aid = itemId.replace(/^agent-/, "");
      jumpToAgentLast(aid);
    }
  };
  const vim = useVimNav({
    onActivate,
    onClosePanel: (panel) => {
      // `c` from navigate mode. Only the thread pane is closable today.
      if (panel === "thread") setThreadParentId(null);
    },
    threadOpen: !!threadParentId,
    rosterVisible: !threadParentId,
  });
  // Mode auto-switch: any textarea/input focus → typing; blur → navigate.
  // Centralized here so individual components stay mode-agnostic.
  useEffect(() => {
    const isEditable = (el: EventTarget | null) =>
      el instanceof HTMLElement && (el.tagName === "TEXTAREA" || el.tagName === "INPUT" || el.isContentEditable);
    const onFocusIn = (e: FocusEvent) => isEditable(e.target) && vim.setMode("typing");
    const onFocusOut = (e: FocusEvent) => {
      if (!isEditable(e.target)) return;
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

  return (
    <AppShellGrid mode={shellMode} threadOpen={!!threadParentId} data-vim-mode={vim.mode}>
      {layout.persistentSidebar && (
        <Sidebar
          activeRoomId={isActivity ? ACTIVITY_ID : (room?.id ?? "")}
          onSelect={selectRoom}
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
        style={threadParentId && layout.threadAsSplit ? ({ "--thread-pane-width": `${threadWidth}px` } as CSSProperties) : undefined}
      >
        {isActivity ? (
          <ActivityView onJumpToRoom={jumpToRoom} onOpenDm={openDmForAgent} threadWidth={threadWidth} onThreadWidth={setThreadWidth} onOpenSettings={openCompactSettings} />
        ) : room ? (
          <>
            {!pushedThreadOpen && (
              <RoomHeader
                room={room}
                tab={tab}
                onTab={setTab}
                theme={theme}
                onToggleTheme={(shiftKey) => setTheme((t) => (shiftKey ? cycleTheme(t) : toggleThemeFamily(t)))}
                skin={skin}
                onToggleSkin={() => setSkin((s) => (s === "brutal" ? "glass" : "brutal"))}
                chatBg={chatBg}
                onChatBg={setChatBg}
                showAgentsButton={rosterPanelAvailable && layout.persistentSidebar}
                onOpenAgents={openAgents}
                onOpenSettings={openCompactSettings}
                {...(displayThreadAuthor && layout.threadAsSplit
                  ? { threadBanner: { author: displayThreadAuthor, onClose: () => setThreadParentId(null) } }
                  : {})}
              />
            )}
            <ShellMainBody
              threadOpen={!!threadParentId}
              style={
                threadParentId
                  && layout.threadAsSplit
                  ? ({
                      gridTemplateColumns: `minmax(0, 1fr) ${threadWidth}px`,
                      "--thread-pane-width": `${threadWidth}px`,
                    } as CSSProperties)
                  : undefined
              }
            >
              {!pushedThreadOpen ? (
                <ShellChatColumn>
                  {tab === "chat" ? (
                    <ChatView
                      room={room}
                      onOpenThread={setThreadParentId}
                      onOpenDm={openDmForAgent}
                      isThreadOpen={!!threadParentId}
                      threadSummaryOpen={threadSummaryOpen}
                      onToggleThreadSummary={() => setThreadSummaryOpen((open) => !open)}
                      showTimeline={layout.timeline}
                      {...(!threadParentId && focusMessageId
                        ? { focusMessageId, onFocusedMessage: () => setFocusMessageId(null) }
                        : {})}
                      {...(communityPanelAvailable
                        ? { onOpenCommunity: openCommunity }
                        : {})}
                    />
                  ) : tab === "board" ? (
                    <BoardView roomId={room.id} />
                  ) : (
                    <Placeholder label="ARTIFACTS — coming in V2" />
                  )}
                </ShellChatColumn>
              ) : null}
              {threadParentId ? (
                <>
                  {layout.threadAsSplit && <ResizeHandle width={threadWidth} onChange={setThreadWidth} />}
                  <ThreadPane
                    room={room}
                    parentId={threadParentId}
                    {...(focusMessageId ? { focusMessageId, onFocused: () => setFocusMessageId(null) } : {})}
                    onClose={() => setThreadParentId(null)}
                    showHeader={!layout.threadAsSplit}
                  />
                </>
              ) : rosterPersistent ? (
                <AgentRoster
                  room={room}
                  onAgentDoubleClick={jumpToAgentLast}
                  onOpenDm={openDmForAgent}
                />
              ) : null}
            </ShellMainBody>
          </>
        ) : (
          <div className="min-h-0 h-full grid place-items-center bg-paper text-ink [border-left:var(--line-2)]">
            <div className="max-w-[520px] [border:var(--line-bold)] shadow-lg bg-paper-2 p-[var(--space-24)]">
              {/* `.brand-mark` kept: shared Sidebar hook (skin-glass + [data-theme] override). */}
              <div className="brand-mark">S</div>
              <h1 className="mt-[16px] mb-[8px] font-display text-[length:var(--text-24)]">No rooms yet</h1>
              <p className="mt-[8px] font-ui leading-[1.45]">Registered sessions will appear as direct messages. Create or join a group to start a room.</p>
            </div>
          </div>
        )}
      </ShellMainColumn>
      {communityPanelAvailable && communityOpen && (
        <div className="shell-overlay shell-overlay-community fixed z-[var(--z-modal)] bg-paper text-ink [border:var(--line)] shadow-lg flex flex-col overflow-hidden" role="dialog" aria-modal="true" aria-label="chats">
          <CompactAppBar
            title="Chats"
            detail={`${rooms.length} rooms`}
            onSettings={openCompactSettings}
            onClose={closeOverlays}
          />
          <Sidebar activeRoomId={room?.id ?? ""} onSelect={selectRoom} mode={vim.mode} />
        </div>
      )}
      {rosterPanelAvailable && agentPanelOpen && room && (
        <div
          className={`shell-overlay shell-overlay-agents shell-overlay-${shellMode} fixed z-[var(--z-modal)] bg-paper text-ink [border:var(--line)] shadow-lg flex flex-col overflow-hidden`}
          role="dialog"
          aria-modal="true"
          aria-label="agents"
        >
          <CompactAppBar
            title="Agents"
            detail={`${room.members.length} in ${room.kind === "group" ? `#${room.name}` : room.name}`}
            onSettings={openCompactSettings}
            onClose={closeOverlays}
          />
          <AgentRoster
            room={room}
            onAgentDoubleClick={jumpToAgentLast}
            onOpenDm={openDmForAgent}
          />
        </div>
      )}
      {layout.bottomNav && (
        <BottomNav
          active={bottomNavTab}
          onChats={onNavChats}
          onActivity={onNavActivity}
          onAgents={onNavAgents}
          agentCount={room?.members.length ?? 0}
        />
      )}
      {layout.settingsSheet && (
        <CompactSettingsSheet
          open={compactSettingsOpen}
          theme={theme}
          skin={skin}
          chatBg={chatBg}
          onToggleAppearance={() => setTheme((current) => toggleThemeFamily(current))}
          onCycleTheme={() => setTheme((current) => cycleTheme(current))}
          onToggleSkin={() => setSkin((current) => (current === "brutal" ? "glass" : "brutal"))}
          onChatBg={setChatBg}
          onClose={closeCompactSettings}
        />
      )}
    </AppShellGrid>
  );
}

// Exported for Storybook (Navigation/CompactAppBar) — the compact Chats/Agents
// overlay header. Rendered inline by the overlays below; the export is story-only.
export function CompactAppBar({
  title,
  detail,
  onSettings,
  onClose,
}: {
  title: string;
  detail?: string;
  onSettings(event: ReactMouseEvent): void;
  onClose(): void;
}) {
  return (
    <div className="compact-appbar flex-none flex items-center justify-between gap-[var(--space-12)] px-[12px] py-[8px] [border-bottom:var(--line)] bg-paper-2">
      <div className="min-w-0 flex items-center gap-[var(--space-8)]">
        <IconButton icon={X} label="close" size={40} iconSize={20} onClick={onClose} />
        <div className="min-w-0 flex flex-col justify-center">
          <div className="font-display text-[length:var(--text-16)] leading-[1.05] tracking-[var(--tracking-sm)] text-ink truncate">
            {title}
          </div>
          {detail ? (
            <div className="mt-[3px] font-mono text-[length:var(--text-10)] leading-none text-ink-soft truncate">
              {detail}
            </div>
          ) : null}
        </div>
      </div>
      <IconButton icon={Settings} label="open display settings" size={40} iconSize={20} onClick={onSettings} />
    </div>
  );
}

// Exported for Storybook (Surfaces/CompactSettingsSheet) — the compact display
// settings bottom sheet (theme / skin / chat background).
export function CompactSettingsSheet({
  open,
  theme,
  skin,
  chatBg,
  onToggleAppearance,
  onCycleTheme,
  onToggleSkin,
  onChatBg,
  onClose,
}: {
  open: boolean;
  theme: ThemeName;
  skin: "brutal" | "glass";
  chatBg: string;
  onToggleAppearance(): void;
  onCycleTheme(): void;
  onToggleSkin(): void;
  onChatBg(id: string): void;
  onClose(): void;
}) {
  return (
    <Sheet open={open} onClose={onClose} ariaLabel="display settings" className="compact-settings-sheet">
        <div className="compact-settings-head flex items-center justify-between gap-[var(--space-12)] px-[14px] py-[12px] [border-bottom:var(--line)] bg-paper-2">
          <div className="min-w-0">
            <div className="font-display text-[length:var(--text-17)] leading-none tracking-[var(--tracking-sm)]">Display</div>
            <div className="mt-[5px] font-mono text-[length:var(--text-10)] leading-none text-ink-soft">
              {themeFamily(theme)} · {titleCase(theme)} · {skin}
            </div>
          </div>
          <button type="button" className="compact-settings-done" onClick={onClose}>Done</button>
        </div>

        <div className="compact-settings-section">
          <SettingsRow
            label="Appearance"
            value={themeFamily(theme) === "light" ? "Light" : "Dark"}
            onClick={onToggleAppearance}
          />
          <SettingsRow
            label="Theme"
            value={titleCase(theme)}
            onClick={onCycleTheme}
          />
          <SettingsRow
            label="Skin"
            value={skin === "brutal" ? "Brutal" : "Glass"}
            onClick={onToggleSkin}
          />
        </div>

        <div className="compact-settings-section">
          <div className="compact-settings-label">Chat background</div>
          <div className="compact-settings-grid">
            {CHAT_BACKGROUNDS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                className={`compact-settings-choice${preset.id === chatBg ? " active" : ""}`}
                onClick={() => onChatBg(preset.id)}
              >
                {preset.name}
              </button>
            ))}
          </div>
        </div>
    </Sheet>
  );
}

// Exported for Storybook (Primitives/SettingsRow).
export function SettingsRow({ label, value, onClick }: { label: string; value: string; onClick(): void }) {
  return (
    <button type="button" className="compact-settings-row" onClick={onClick}>
      <span>{label}</span>
      <strong>{value}</strong>
    </button>
  );
}

// Exported for Storybook (Surfaces/Placeholder) — unimplemented-tab stamp.
export function Placeholder({ label }: { label: string }) {
  return (
    <div className="placeholder">
      <div className="placeholder-stamp">{label}</div>
    </div>
  );
}
