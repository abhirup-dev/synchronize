import { useEffect, useMemo, useState } from "react";
import type { DataSource } from "./data/types.ts";
import { DataSourceProvider, useRooms } from "./data/context.tsx";
import { MockDataSource } from "./data/mock.ts";
import { Sidebar } from "./components/Sidebar.tsx";
import { RoomHeader, type RoomTab } from "./components/RoomHeader.tsx";
import { ChatView } from "./components/ChatView.tsx";
import { AgentRoster } from "./components/AgentRoster.tsx";
import { TimelineRail } from "./components/TimelineRail.tsx";
import { ContextMenuProvider } from "./components/ContextMenu.tsx";
import { ThreadPane } from "./components/ThreadPane.tsx";

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
        <Shell />
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
  if (!room) return null;

  return (
    <div className={`app-shell${threadParentId ? " thread-open" : ""}`}>
      <Sidebar activeRoomId={room.id} onSelect={setActiveId} />
      <main className="main">
        <RoomHeader room={room} tab={tab} onTab={setTab} />
        <div className="main-body">
          <div className="tab-content">
            {tab === "chat" ? (
              <ChatView room={room} onOpenThread={setThreadParentId} />
            ) : tab === "board" ? (
              <Placeholder label="BOARD — coming in V2" />
            ) : (
              <Placeholder label="ARTIFACTS — coming in V2" />
            )}
          </div>
          {!threadParentId && <TimelineRail roomId={room.id} />}
          {threadParentId ? (
            <ThreadPane room={room} parentId={threadParentId} onClose={() => setThreadParentId(null)} />
          ) : (
            <AgentRoster room={room} focusedAgent={focusedAgent} onFocus={setFocusedAgent} />
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
