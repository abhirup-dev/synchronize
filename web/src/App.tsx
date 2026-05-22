import { useEffect, useMemo, useState } from "react";
import type { DataSource } from "./data/types.ts";
import { DataSourceProvider, useRooms, useMessages, useAgents } from "./data/context.tsx";
import { MockDataSource } from "./data/mock.ts";
import { Sidebar } from "./components/Sidebar.tsx";
import { RoomHeader, type RoomTab } from "./components/RoomHeader.tsx";
import { ChatView } from "./components/ChatView.tsx";
import { AgentRoster } from "./components/AgentRoster.tsx";
import { ContextMenuProvider } from "./components/ContextMenu.tsx";
import { ThreadPane } from "./components/ThreadPane.tsx";
import { ResizeHandle } from "./components/ResizeHandle.tsx";
import { useVimNav, type VimPanel } from "./hooks/useVimNav.ts";
import { ToastProvider, useToast } from "./components/Toast.tsx";

// ─── DataSource selection ──────────────────────────────────────────────────
// Default: mock. Switch to live via localStorage.SYNCHRONIZE_DATA_SOURCE='live'.
// The live adapter is intentionally not wired in V0; see DESIGN.md and the
// sync-jix follow-up beads.
function pickDataSource(): DataSource {
  return new MockDataSource();
}

export function App() {
  const ds = useMemo(pickDataSource, []);
  useEffect(() => {
    void ds.connect();
    return () => ds.disconnect();
  }, [ds]);
  return (
    <DataSourceProvider value={ds}>
      <ContextMenuProvider>
        <ToastProvider>
          <Shell />
        </ToastProvider>
      </ContextMenuProvider>
    </DataSourceProvider>
  );
}

function Shell() {
  const rooms = useRooms();
  const [activeId, setActiveId] = useState<string>(rooms[0]?.id ?? "");
  const [tab, setTab] = useState<RoomTab>("chat");
  const [focusedAgent, setFocusedAgent] = useState<string | null>(null);
  const [threadParentId, setThreadParentId] = useState<string | null>(null);
  const [threadWidth, setThreadWidth] = useState<number>(() => {
    const stored = Number(localStorage.getItem("synchronize.threadWidth"));
    return Number.isFinite(stored) && stored >= 320 && stored <= 820 ? stored : 420;
  });
  useEffect(() => {
    localStorage.setItem("synchronize.threadWidth", String(threadWidth));
  }, [threadWidth]);
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    return (localStorage.getItem("synchronize.theme") as "light" | "dark" | null) ?? "light";
  });

  // Reset secondary state when switching rooms.
  useEffect(() => {
    setTab("chat");
    setFocusedAgent(null);
    setThreadParentId(null);
  }, [activeId]);

  useEffect(() => {
    document.documentElement.dataset["theme"] = theme;
    localStorage.setItem("synchronize.theme", theme);
  }, [theme]);

  const room = rooms.find((r) => r.id === activeId) ?? rooms[0];
  const roomMessages = useMessages(room?.id ?? "");
  const agents = useAgents();
  const toast = useToast();

  // Jump-to-last-message-by-agent: scrolls to the latest message authored by
  // `agentId` in the active room, flashes it with the throbbing yellow ring.
  // If the agent has no messages in this room, fire a toast.
  const jumpToAgentLast = (agentId: string) => {
    if (!room) return;
    const agent = agents.find((a) => a.id === agentId);
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
    const onFocusOut = (e: FocusEvent) => isEditable(e.target) && vim.setMode("navigate");
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    return () => {
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
    };
  }, [vim]);

  if (!room) return null;

  return (
    <div className={`app-shell${threadParentId ? " thread-open" : ""}`} data-vim-mode={vim.mode}>
      <Sidebar activeRoomId={room.id} onSelect={setActiveId} mode={vim.mode} />
      <main className="main">
        <RoomHeader room={room} tab={tab} onTab={setTab} />
        <div
          className="main-body"
          style={
            threadParentId
              ? { gridTemplateColumns: `minmax(0, 1fr) 6px ${threadWidth}px` }
              : undefined
          }
        >
          <div className="tab-content">
            {tab === "chat" ? (
              <ChatView room={room} onOpenThread={setThreadParentId} isThreadOpen={!!threadParentId} />
            ) : tab === "board" ? (
              <Placeholder label="BOARD — coming in V2" />
            ) : (
              <Placeholder label="ARTIFACTS — coming in V2" />
            )}
          </div>
          {threadParentId ? (
            <>
              <ResizeHandle width={threadWidth} onChange={setThreadWidth} />
              <ThreadPane room={room} parentId={threadParentId} onClose={() => setThreadParentId(null)} />
            </>
          ) : (
            <AgentRoster
              room={room}
              focusedAgent={focusedAgent}
              onFocus={setFocusedAgent}
              onAgentDoubleClick={jumpToAgentLast}
            />
          )}
        </div>
      </main>
      <button
        className="theme-toggle"
        onClick={() => setTheme((t) => (t === "light" ? "dark" : "light"))}
        title="toggle theme"
      >
        {theme === "light" ? "🌙" : "☀️"}
      </button>
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
