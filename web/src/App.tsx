import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { DataSource } from "./data/types.ts";
import { DataSourceProvider, useRooms, useMessages, useAgents } from "./data/context.tsx";
import { MockDataSource } from "./data/mock.ts";
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
import { ArchiveRecoveryProvider } from "./components/ArchiveRecovery.tsx";
import { useVimNav, type VimPanel } from "./hooks/useVimNav.ts";
import { ToastProvider, useToast } from "./components/Toast.tsx";
import { roomAgent } from "./data/roomAgents.ts";

const LIGHT_THEMES = ["light", "rose-pine-dawn"] as const;
const DARK_THEMES = ["dark", "kanagawa-wave", "catppuccin-mocha"] as const;
const ALL_THEMES = [...LIGHT_THEMES, ...DARK_THEMES] as const;

type ThemeName = (typeof ALL_THEMES)[number];
type ShellMode = "desktop" | "medium" | "compact";

function shellModeForWidth(width: number): ShellMode {
  if (width < 780) return "compact";
  if (width < 1180) return "medium";
  return "desktop";
}

function isThemeName(value: string | null): value is ThemeName {
  return ALL_THEMES.includes(value as ThemeName);
}

function themeFamily(theme: ThemeName): "light" | "dark" {
  return LIGHT_THEMES.includes(theme as (typeof LIGHT_THEMES)[number]) ? "light" : "dark";
}

function cycleTheme(theme: ThemeName): ThemeName {
  const family = themeFamily(theme) === "light" ? LIGHT_THEMES : DARK_THEMES;
  const index = (family as readonly ThemeName[]).indexOf(theme);
  return family[(index + 1) % family.length] as ThemeName;
}

function toggleThemeFamily(theme: ThemeName): ThemeName {
  return themeFamily(theme) === "light" ? "kanagawa-wave" : "light";
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
          </ArchiveRecoveryProvider>
        </ToastProvider>
      </ContextMenuProvider>
    </DataSourceProvider>
  );
}

function ConnectionError({ message }: { message: string }) {
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

function Shell() {
  const rooms = useRooms();
  // Land on the first room as before; the sidebar's Activity item is the entry
  // point. Fall back to Activity only when there are no rooms yet (more useful
  // than an empty "no rooms" pane).
  const [activeId, setActiveId] = useState<string>(rooms[0]?.id ?? ACTIVITY_ID);
  const [tab, setTab] = useState<RoomTab>("chat");
  const [focusedAgent, setFocusedAgent] = useState<string | null>(null);
  const [threadParentId, setThreadParentId] = useState<string | null>(null);
  const [shellMode, setShellMode] = useState<ShellMode>(() => shellModeForWidth(window.innerWidth));
  const [communityOpen, setCommunityOpen] = useState(false);
  const [agentPanelOpen, setAgentPanelOpen] = useState(false);
  const overlayRestoreRef = useRef<HTMLElement | null>(null);
  const [threadSummaryOpen, setThreadSummaryOpen] = useState(false);
  const [threadWidth, setThreadWidth] = useState<number>(() => {
    const stored = Number(localStorage.getItem("synchronize.threadWidth"));
    return Number.isFinite(stored) && stored >= 320 && stored <= 820 ? stored : 420;
  });
  useEffect(() => {
    localStorage.setItem("synchronize.threadWidth", String(threadWidth));
  }, [threadWidth]);
  const [theme, setTheme] = useState<ThemeName>(() => {
    const stored = localStorage.getItem("synchronize.theme");
    return isThemeName(stored) ? stored : "kanagawa-wave";
  });

  const isActivity = activeId === ACTIVITY_ID;

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

  // Reset secondary state when switching rooms.
  useEffect(() => {
    setTab("chat");
    setFocusedAgent(null);
    setThreadParentId(null);
    setThreadSummaryOpen(false);
    setAgentPanelOpen(false);
  }, [activeId]);

  useEffect(() => {
    if (shellMode !== "compact") setCommunityOpen(false);
    if (shellMode === "desktop") setAgentPanelOpen(false);
  }, [shellMode]);

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

  useEffect(() => {
    document.documentElement.dataset["theme"] = theme;
    localStorage.setItem("synchronize.theme", theme);
  }, [theme]);

  useEffect(() => {
    // Skin = aesthetic system (border/shadow/radius language), orthogonal to
    // theme (palette). Only "brutal" exists today; see the skin contract block
    // in styles.css before adding another.
    document.documentElement.dataset["skin"] = localStorage.getItem("synchronize.skin") ?? "brutal";
  }, []);

  const room = rooms.find((r) => r.id === activeId) ?? rooms[0];
  const roomMessages = useMessages(room?.id ?? "");
  const agents = useAgents();
  const toast = useToast();
  const threadParent = threadParentId ? roomMessages.find((message) => message.id === threadParentId) : undefined;
  const threadAuthor = threadParent && room
    ? agents.find((agent) => agent.id === threadParent.authorId)
    : undefined;
  const displayThreadAuthor = threadAuthor && room ? roomAgent(threadAuthor, room) : undefined;
  const rosterPersistent = shellMode === "desktop" && !threadParentId;
  const rosterPanelAvailable = shellMode !== "desktop" && !threadParentId;
  const communityPanelAvailable = shellMode === "compact";

  const rememberOverlayOpener = () => {
    overlayRestoreRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  };
  const closeOverlays = () => {
    setCommunityOpen(false);
    setAgentPanelOpen(false);
    queueMicrotask(() => overlayRestoreRef.current?.focus());
  };
  const selectRoom = (id: string) => {
    setActiveId(id);
    setCommunityOpen(false);
  };

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
    <div
      className={`app-shell shell-${shellMode}${threadParentId ? " thread-open" : ""}`}
      data-vim-mode={vim.mode}
      data-shell-mode={shellMode}
    >
      {shellMode !== "compact" && (
        <Sidebar activeRoomId={isActivity ? ACTIVITY_ID : (room?.id ?? "")} onSelect={selectRoom} mode={vim.mode} />
      )}
      <main
        className="main"
        style={threadParentId ? ({ "--thread-pane-width": `${threadWidth}px` } as CSSProperties) : undefined}
      >
        {isActivity ? (
          <ActivityView onJumpToRoom={jumpToRoom} threadWidth={threadWidth} onThreadWidth={setThreadWidth} />
        ) : room ? (
          <>
            <RoomHeader
              room={room}
              tab={tab}
              onTab={setTab}
              theme={theme}
              themeIcon={themeFamily(theme) === "light" ? "🌙" : "☀️"}
              onToggleTheme={(shiftKey) => setTheme((t) => (shiftKey ? cycleTheme(t) : toggleThemeFamily(t)))}
              showAgentsButton={rosterPanelAvailable}
              onOpenAgents={() => {
                rememberOverlayOpener();
                setAgentPanelOpen(true);
              }}
              {...(displayThreadAuthor
                ? { threadBanner: { author: displayThreadAuthor, onClose: () => setThreadParentId(null) } }
                : {})}
            />
            <div
              className={`main-body${threadParentId ? " thread-open" : ""}`}
              style={
                threadParentId
                  ? ({
                      gridTemplateColumns: `minmax(0, 1fr) ${threadWidth}px`,
                      "--thread-pane-width": `${threadWidth}px`,
                    } as CSSProperties)
                  : undefined
              }
            >
              <div className="tab-content">
                {tab === "chat" ? (
                  <ChatView
                    room={room}
                    onOpenThread={setThreadParentId}
                    isThreadOpen={!!threadParentId}
                    threadSummaryOpen={threadSummaryOpen}
                    onToggleThreadSummary={() => setThreadSummaryOpen((open) => !open)}
                    showTimeline={shellMode !== "compact"}
                    {...(communityPanelAvailable
                      ? {
                          onOpenCommunity: () => {
                            rememberOverlayOpener();
                            setCommunityOpen(true);
                          },
                        }
                      : {})}
                  />
                ) : tab === "board" ? (
                  <BoardView roomId={room.id} />
                ) : (
                  <Placeholder label="ARTIFACTS — coming in V2" />
                )}
              </div>
              {threadParentId ? (
                <>
                  <ResizeHandle width={threadWidth} onChange={setThreadWidth} />
                  <ThreadPane room={room} parentId={threadParentId} onClose={() => setThreadParentId(null)} showHeader={false} />
                </>
              ) : rosterPersistent ? (
                <AgentRoster
                  room={room}
                  focusedAgent={focusedAgent}
                  onFocus={setFocusedAgent}
                  onAgentDoubleClick={jumpToAgentLast}
                />
              ) : null}
            </div>
          </>
        ) : (
          <div className="empty-main">
            <div className="empty-main-box">
              <div className="brand-mark">S</div>
              <h1>No rooms yet</h1>
              <p>Registered sessions will appear as direct messages. Create or join a group to start a room.</p>
            </div>
          </div>
        )}
      </main>
      {communityPanelAvailable && communityOpen && (
        <div className="shell-overlay shell-overlay-community" role="dialog" aria-modal="true" aria-label="communities">
          <div className="shell-overlay-head">
            <span>Communities</span>
            <button type="button" className="shell-overlay-close" onClick={closeOverlays} aria-label="close communities">×</button>
          </div>
          <Sidebar activeRoomId={room?.id ?? ""} onSelect={selectRoom} mode={vim.mode} />
        </div>
      )}
      {rosterPanelAvailable && agentPanelOpen && room && (
        <div
          className={`shell-overlay shell-overlay-agents shell-overlay-${shellMode}`}
          role="dialog"
          aria-modal="true"
          aria-label="agents"
        >
          <div className="shell-overlay-head">
            <span>Agents</span>
            <button type="button" className="shell-overlay-close" onClick={closeOverlays} aria-label="close agents">×</button>
          </div>
          <AgentRoster
            room={room}
            focusedAgent={focusedAgent}
            onFocus={setFocusedAgent}
            onAgentDoubleClick={jumpToAgentLast}
          />
        </div>
      )}
    </div>
  );
}

function Placeholder({ label }: { label: string }) {
  return (
    <div className="placeholder">
      <div className="placeholder-stamp">{label}</div>
    </div>
  );
}
