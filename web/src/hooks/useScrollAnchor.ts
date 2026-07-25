import { useEffect, useRef } from "react";
import type { Virtualizer } from "@tanstack/react-virtual";
import { useDataSource } from "../data/context.tsx";
import type { Message } from "../data/types.ts";

/**
 * Remembers where you were in a room by MESSAGE, not by scroll offset.
 *
 * The router restores an offset, and @tanstack/react-virtual estimates row
 * heights until they are measured — so the same offset maps to a different
 * message on a later visit, and restoration lands near where you were instead of
 * on it. An anchor id is exact.
 *
 * In-memory and tab-scoped on purpose: "return to the room I was reading" is a
 * property of this session. After a reload the right default is the newest
 * message, which is what no anchor gives you.
 */
const anchorByRoom = new Map<string, string>();

interface ScrollAnchorOptions {
  roomId: string;
  messages: Message[];
  virtualizer: Virtualizer<HTMLDivElement, Element>;
  /** Message ids currently rendered, so the anchor can be looked up. */
  indexByMessageId: Map<string, number>;
  /** Scroll the list to a message and flash it. */
  jumpTo: (messageId: string) => void;
  /** An explicit ?focus= target. It always wins over a remembered anchor. */
  focusMessageId?: string | undefined;
}

export function useScrollAnchor({
  roomId,
  messages,
  virtualizer,
  indexByMessageId,
  jumpTo,
  focusMessageId,
}: ScrollAnchorOptions): void {
  const ds = useDataSource();
  // One restore per room visit. Without this the anchor would be re-applied on
  // every arriving message, pinning the user in place.
  const restoredRoomRef = useRef<string | null>(null);
  const roomIdRef = useRef(roomId);
  roomIdRef.current = roomId;

  // Record the top of the viewport as the user scrolls. Read off the
  // virtualizer rather than the DOM: the row the offset points at is exactly
  // what the virtualizer already computed.
  useEffect(() => {
    const element = virtualizer.scrollElement;
    if (!element) return;
    const record = () => {
      const offset = virtualizer.scrollOffset ?? 0;
      const first = virtualizer.getVirtualItems().find((item) => item.end > offset + 1);
      const id = first === undefined ? undefined : messages[first.index]?.id;
      if (id) anchorByRoom.set(roomIdRef.current, id);
    };
    element.addEventListener("scroll", record, { passive: true });
    return () => element.removeEventListener("scroll", record);
  }, [virtualizer, messages]);

  useEffect(() => {
    // An address that names a message is an instruction; an anchor is a memory.
    if (focusMessageId) {
      restoredRoomRef.current = roomId;
      return;
    }
    if (restoredRoomRef.current === roomId) return;
    const anchor = anchorByRoom.get(roomId);
    if (!anchor) {
      restoredRoomRef.current = roomId;
      return;
    }
    if (indexByMessageId.has(anchor)) {
      restoredRoomRef.current = roomId;
      jumpTo(anchor);
      return;
    }
    // The anchor scrolled out of the loaded window while we were away. Fetch the
    // window around it rather than silently landing at the bottom; the next run
    // of this effect finds it loaded.
    void ds
      .hydrateDeepLinkTarget({
        roomId,
        surface: "group-main",
        focusMessageId: anchor,
        threadParentId: null,
        linkId: anchor.startsWith("e:") ? anchor.slice(2) : anchor,
        eventId: Number(anchor.startsWith("e:") ? anchor.slice(2) : anchor) || 0,
      })
      .catch(() => {
        // Deleted, or a mock id with no window to fetch. Give up on the anchor
        // rather than retrying forever.
        anchorByRoom.delete(roomId);
        restoredRoomRef.current = roomId;
      });
  }, [roomId, focusMessageId, indexByMessageId, jumpTo, ds]);
}

/** Test seam: the anchor store is module state, so it needs an explicit reset. */
export function clearScrollAnchors(): void {
  anchorByRoom.clear();
}
