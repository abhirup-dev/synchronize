import { ActivityView } from "../../components/ActivityView.tsx";
import { useShellChrome } from "../../shell/chrome-context.tsx";
import { useNavigateToRoom } from "../router.tsx";

/** The cross-room activity feed. A destination, not a room, so it has no address
 *  beyond its own path and no loader gate. */
export function ActivityLeaf() {
  const chrome = useShellChrome();
  const goToRoom = useNavigateToRoom();
  return (
    <ActivityView
      onJumpToRoom={(roomId, messageId) => goToRoom(roomId, messageId)}
      onOpenDm={chrome.openDmForAgent}
      threadWidth={chrome.threadWidth}
      onThreadWidth={chrome.setThreadWidth}
      onOpenSettings={chrome.openCompactSettings}
    />
  );
}
