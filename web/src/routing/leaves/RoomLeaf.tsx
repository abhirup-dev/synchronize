import { Outlet, useSearch } from "@tanstack/react-router";
import { useState } from "react";
import { AgentRoster } from "../../components/AgentRoster.tsx";
import { BoardView } from "../../components/BoardView.tsx";
import { ChatView } from "../../components/ChatView.tsx";
import { RoomHeader } from "../../components/RoomHeader.tsx";
import { useRooms } from "../../data/context.tsx";
import type { Room } from "../../data/types.ts";
import { cycleTheme, toggleThemeFamily } from "../../hooks/usePersistentTheme.ts";
import { Placeholder } from "../../shell/compact-chrome.tsx";
import { useShellChrome } from "../../shell/chrome-context.tsx";
import { ShellChatColumn, ShellMainBody } from "../../shell-layout.tsx";
import { useShellLayout } from "../../shell-mode.tsx";
import { useActiveRoomId, useClearFocus, useNavigateRoomTab, useNavigateToThread, useRoomTab } from "../router.tsx";
import { NoRooms } from "./NoRooms.tsx";

/**
 * A room address. Both the group and DM addresses mount this layout: the room it
 * shows comes from the loader gate, not from which route matched. The surface
 * inside it — chat, a board, artifacts — is a nested route.
 */
export function RoomLayout() {
  const room = useAddressedRoom();
  const layout = useShellLayout();
  const chrome = useShellChrome();
  const tab = useRoomTab();
  const goToTab = useNavigateRoomTab();

  if (!room) return <NoRooms />;

  return (
    <>
      <RoomHeader
        room={room}
        tab={tab}
        onTab={(next) => goToTab(next, room)}
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
        <Outlet />
        {layout.rosterColumn ? (
          <AgentRoster room={room} onAgentDoubleClick={chrome.jumpToAgentLast} onOpenDm={chrome.openDmForAgent} />
        ) : null}
      </ShellMainBody>
    </>
  );
}

export function ChatLeaf() {
  const room = useAddressedRoom();
  const { focus } = useSearch({ strict: false }) as { focus?: string };
  const openThread = useNavigateToThread();
  const layout = useShellLayout();
  const chrome = useShellChrome();
  const [threadSummaryOpen, setThreadSummaryOpen] = useState(false);
  const clearFocus = useClearFocus();

  if (!room) return null;

  return (
    <ShellChatColumn>
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
    </ShellChatColumn>
  );
}

export function BoardLeaf() {
  const room = useAddressedRoom();
  if (!room) return null;
  return (
    <ShellChatColumn>
      <BoardView roomId={room.id} />
    </ShellChatColumn>
  );
}

export function ArtifactsLeaf() {
  return (
    <ShellChatColumn>
      <Placeholder label="ARTIFACTS — coming in V2" />
    </ShellChatColumn>
  );
}

/** The room the matched address gated on. */
function useAddressedRoom(): Room | undefined {
  const roomId = useActiveRoomId();
  return useRooms().find((candidate) => candidate.id === roomId);
}
