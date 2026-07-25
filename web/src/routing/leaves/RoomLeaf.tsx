import { useNavigate, useSearch } from "@tanstack/react-router";
import { useState, type CSSProperties } from "react";
import { AgentRoster } from "../../components/AgentRoster.tsx";
import { BoardView } from "../../components/BoardView.tsx";
import { ChatView } from "../../components/ChatView.tsx";
import { RoomHeader, type RoomTab } from "../../components/RoomHeader.tsx";
import { useRooms } from "../../data/context.tsx";
import { cycleTheme, toggleThemeFamily } from "../../hooks/usePersistentTheme.ts";
import { Placeholder } from "../../shell/compact-chrome.tsx";
import { useShellChrome } from "../../shell/chrome-context.tsx";
import { ShellChatColumn, ShellMainBody } from "../../shell-layout.tsx";
import { useShellLayout } from "../../shell-mode.tsx";
import { useActiveRoomId, useNavigateToThread } from "../router.tsx";
import { NoRooms } from "./NoRooms.tsx";

/**
 * The chat surface for a group or DM address. Both addresses mount this one leaf:
 * the room it shows comes from the loader gate, not from which route matched.
 */
export function RoomLeaf() {
  const rooms = useRooms();
  const roomId = useActiveRoomId();
  const room = rooms.find((candidate) => candidate.id === roomId);
  const { focus } = useSearch({ strict: false }) as { focus?: string };
  const navigate = useNavigate();
  const openThread = useNavigateToThread();
  const layout = useShellLayout();
  const chrome = useShellChrome();
  const [tab, setTab] = useState<RoomTab>("chat");
  const [threadSummaryOpen, setThreadSummaryOpen] = useState(false);

  if (!room) return <NoRooms />;

  // Clearing ?focus= replaces rather than pushes: the back button moves between
  // rooms, not between scroll positions.
  const clearFocus = () => void navigate({ to: ".", search: ({ view }) => (view ? { view } : {}), replace: true });

  return (
    <>
      <RoomHeader
        room={room}
        tab={tab}
        onTab={setTab}
        theme={chrome.theme}
        onToggleTheme={(shiftKey) => chrome.setTheme((current) => (shiftKey ? cycleTheme(current) : toggleThemeFamily(current)))}
        skin={chrome.skin}
        onToggleSkin={() => chrome.setSkin((current) => (current === "brutal" ? "glass" : "brutal"))}
        chatBg={chrome.chatBg}
        onChatBg={chrome.setChatBg}
        showAgentsButton={layout.rosterAsOverlay && layout.persistentSidebar}
        onOpenAgents={chrome.openAgents}
        onOpenSettings={chrome.openCompactSettings}
      />
      <ShellMainBody>
        <ShellChatColumn>
          {tab === "chat" ? (
            <ChatView
              room={room}
              onOpenThread={openThread}
              onOpenDm={chrome.openDmForAgent}
              threadSummaryOpen={threadSummaryOpen}
              onToggleThreadSummary={() => setThreadSummaryOpen((open) => !open)}
              showTimeline={layout.timeline}
              {...(focus ? { focusMessageId: focus, onFocusedMessage: clearFocus } : {})}
              {...(layout.communityOverlay ? { onOpenCommunity: chrome.openCommunity } : {})}
            />
          ) : tab === "board" ? (
            <BoardView roomId={room.id} />
          ) : (
            <Placeholder label="ARTIFACTS — coming in V2" />
          )}
        </ShellChatColumn>
        {layout.rosterColumn ? (
          <AgentRoster room={room} onAgentDoubleClick={chrome.jumpToAgentLast} onOpenDm={chrome.openDmForAgent} />
        ) : null}
      </ShellMainBody>
    </>
  );
}

/** Shared by RoomLeaf and ThreadLeaf: the split's grid template when open. */
export function threadSplitStyle(threadWidth: number): CSSProperties {
  return {
    gridTemplateColumns: `minmax(0, 1fr) ${threadWidth}px`,
    "--thread-pane-width": `${threadWidth}px`,
  } as CSSProperties;
}
