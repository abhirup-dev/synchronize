import { useSearch } from "@tanstack/react-router";
import { useState } from "react";
import { ChatView } from "../../components/ChatView.tsx";
import { ResizeHandle } from "../../components/ResizeHandle.tsx";
import { RoomHeader, type RoomTab } from "../../components/RoomHeader.tsx";
import { ThreadPane } from "../../components/ThreadPane.tsx";
import { useRooms } from "../../data/context.tsx";
import { cycleTheme, toggleThemeFamily } from "../../hooks/usePersistentTheme.ts";
import { useShellChrome } from "../../shell/chrome-context.tsx";
import { ShellChatColumn, ShellMainBody } from "../../shell-layout.tsx";
import { useShellLayout } from "../../shell-mode.tsx";
import { threadRoute, useClearFocus, useNavigateToRoom } from "../router.tsx";
import { threadSplitStyle } from "../../shell/thread-split.ts";
import { NoRooms } from "./NoRooms.tsx";

/**
 * A thread address. The loader has already resolved which room the thread lives
 * in and hydrated the window around it, so this renders with no waiting state of
 * its own — that is the whole point of moving the deep-link choreography into a
 * loader.
 *
 * Desktop shows the thread beside the chat; narrower modes push a full panel, so
 * the chat column is not rendered at all there.
 */
export function ThreadLeaf() {
  const { roomId, threadParentId } = threadRoute.useLoaderData();
  const { focus } = useSearch({ strict: false }) as { focus?: string };
  const rooms = useRooms();
  const room = rooms.find((candidate) => candidate.id === roomId);
  const goToRoom = useNavigateToRoom();
  const layout = useShellLayout();
  const chrome = useShellChrome();
  const [tab, setTab] = useState<RoomTab>("chat");
  const clearFocus = useClearFocus();
  // A popped-out thread is the whole window, so it never shows the chat column
  // it would sit beside inside the shell.
  const asSplit = layout.threadAsSplit && !chrome.pane;

  if (!room) return <NoRooms />;

  const closeThread = () => goToRoom(room.id);

  return (
    <>
      {asSplit && (
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
          onOpenSettings={chrome.openCompactSettings}
          onCloseThread={closeThread}
        />
      )}
      <ShellMainBody threadOpen style={asSplit ? threadSplitStyle(chrome.threadWidth) : undefined}>
        {asSplit && (
          <>
            <ShellChatColumn>
              <ChatView room={room} isThreadOpen onOpenDm={chrome.openDmForAgent} showTimeline={layout.timeline} />
            </ShellChatColumn>
            <ResizeHandle width={chrome.threadWidth} onChange={chrome.setThreadWidth} />
          </>
        )}
        <ThreadPane
          room={room}
          parentId={threadParentId}
          {...(focus ? { focusMessageId: focus, onFocused: clearFocus } : {})}
          onClose={closeThread}
          showHeader={!asSplit}
        />
      </ShellMainBody>
    </>
  );
}
