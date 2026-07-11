import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { api } from './api';
import type { ActivityFeed, Agent, Room, SyncEvent, WebState } from './types';

// ponytail: 4s REST polling (the contract's sanctioned fallback); SSE
// invalidation can be layered on later if polling ever feels slow.
const POLL_MS = 4000;

// Cheap change signature so unchanged polls skip setState entirely —
// re-rendering every screen every poll chokes low-end devices/emulators.
function changeSig(
  state: WebState,
  activity: ActivityFeed | null,
  roomEvents: Record<string, SyncEvent[]>,
): string {
  const parts: (string | number)[] = [state.cursor, state.peers.length];
  for (const p of state.peers) if (p.online) parts.push(p.peer_id.slice(0, 8));
  if (activity) {
    parts.push(activity.awaiting_count, activity.events.length, activity.events[0]?.event_id ?? 0);
  }
  for (const [id, evs] of Object.entries(roomEvents)) {
    let extras = 0;
    for (const e of evs) {
      extras += (e.reactions?.length ?? 0) + (e.acked_count ?? 0) + (e.reply_count ?? 0);
    }
    parts.push(id, evs.length, evs[evs.length - 1]?.event_id ?? 0, extras);
  }
  return parts.join('|');
}

export interface SyncState {
  peerId: string | null;
  connected: boolean;
  error: string | null;
  state: WebState | null;
  rooms: Room[];
  agents: Agent[];
  activity: ActivityFeed | null;
  roomEvents: Record<string, SyncEvent[]>;
}

interface SyncApi extends SyncState {
  openRoom: (roomId: string) => void;
  closeRoom: (roomId: string) => void;
  refresh: () => Promise<void>;
  sendMessage: (room: Room, text: string, inReplyTo?: number) => Promise<void>;
  ack: (eventIds?: number[]) => Promise<void>;
  react: (eventId: number, emoji: string) => Promise<void>;
}

const Ctx = createContext<SyncApi | null>(null);

function buildRooms(s: WebState, selfId: string): Room[] {
  const summaries = new Map(s.room_summaries.map((r) => [r.group_id, r]));
  const groupRooms: Room[] = s.groups.map((g) => {
    const sum = summaries.get(g.group_id);
    return {
      id: `group:${g.group_id}`,
      kind: 'group',
      name: g.name,
      // Roster events carry JSON bodies (e.g. {"alias":...}); don't show them as previews.
      preview: sum?.last_preview?.startsWith('{') ? '' : (sum?.last_preview ?? ''),
      lastAt: sum?.last_event_at ?? null,
      messageCount: sum?.message_count ?? 0,
      members: s.memberships.filter((m) => m.group_id === g.group_id && m.active),
      group: g,
    };
  });
  const dmRooms: Room[] = s.peers
    .filter((p) => p.peer_id !== selfId && !p.archived_at)
    .map((p) => ({
      id: `dm:${p.peer_id}`,
      kind: 'dm' as const,
      name: p.session_name || p.peer_id,
      preview: p.purpose ?? '',
      lastAt: p.last_activity_at ?? null,
      messageCount: 0,
      members: [],
      online: p.online,
      peer: p,
    }));
  const ts = (r: Room) => (r.lastAt ? new Date(r.lastAt).getTime() : 0);
  groupRooms.sort((a, b) => ts(b) - ts(a));
  dmRooms.sort((a, b) => ts(b) - ts(a));
  return [...groupRooms, ...dmRooms];
}

function buildAgents(s: WebState, selfId: string): Agent[] {
  const runtime = new Map(s.agent_runtime_details.map((r) => [r.peer_id, r]));
  const lifecycle = new Map(s.launch_lifecycle.map((l) => [l.peer_id, l]));
  const groupName = new Map(s.groups.map((g) => [g.group_id, g.name]));
  return s.peers
    .filter((p) => p.peer_id !== selfId && p.tool !== 'web')
    .map((p) => ({
      peer: p,
      runtime: runtime.get(p.peer_id),
      lifecycle: lifecycle.get(p.peer_id),
      rooms: s.memberships
        .filter((m) => m.peer_id === p.peer_id && m.active)
        .map((m) => groupName.get(m.group_id) ?? `#${m.group_id}`),
    }))
    .sort((a, b) => Number(b.peer.online) - Number(a.peer.online));
}

export function SyncProvider({ children }: { children: React.ReactNode }) {
  const [snap, setSnap] = useState<SyncState>({
    peerId: null,
    connected: false,
    error: null,
    state: null,
    rooms: [],
    agents: [],
    activity: null,
    roomEvents: {},
  });
  const peerRef = useRef<string | null>(null);
  const openRoomsRef = useRef<Map<string, number>>(new Map());
  const sigRef = useRef('');
  const inFlightRef = useRef(false);

  const refresh = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      if (!peerRef.current) {
        const s = await api.registerSession();
        peerRef.current = s.peer.peer_id;
      }
      const peerId = peerRef.current;
      const [state, activity] = await Promise.all([api.summaryState(peerId), api.activity(peerId)]);
      const roomIds = [...openRoomsRef.current.keys()];
      const roomStates = await Promise.all(roomIds.map((id) => api.roomState(peerId, id).catch(() => null)));
      const freshRooms: Record<string, SyncEvent[]> = {};
      roomIds.forEach((id, i) => {
        const rs = roomStates[i];
        if (rs?.events) freshRooms[id] = [...rs.events].sort((a, b) => a.event_id - b.event_id);
      });
      const sig = changeSig(state, activity, freshRooms);
      if (sig === sigRef.current) return;
      sigRef.current = sig;
      setSnap((prev) => ({
        peerId,
        connected: true,
        error: null,
        state,
        rooms: buildRooms(state, peerId),
        agents: buildAgents(state, peerId),
        activity,
        roomEvents: { ...prev.roomEvents, ...freshRooms },
      }));
    } catch (e) {
      sigRef.current = '';
      setSnap((prev) =>
        prev.connected || prev.error !== String(e) ? { ...prev, connected: false, error: String(e) } : prev,
      );
    } finally {
      inFlightRef.current = false;
    }
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, POLL_MS);
    return () => clearInterval(t);
  }, [refresh]);

  const openRoom = useCallback(
    (roomId: string) => {
      openRoomsRef.current.set(roomId, (openRoomsRef.current.get(roomId) ?? 0) + 1);
      refresh();
    },
    [refresh],
  );

  const closeRoom = useCallback((roomId: string) => {
    const n = (openRoomsRef.current.get(roomId) ?? 1) - 1;
    if (n <= 0) openRoomsRef.current.delete(roomId);
    else openRoomsRef.current.set(roomId, n);
  }, []);

  const sendMessage = useCallback(
    async (room: Room, text: string, inReplyTo?: number) => {
      const peerId = peerRef.current;
      if (!peerId) throw new Error('not connected');
      if (room.kind === 'group') await api.sendGroup(room.name, peerId, text, inReplyTo);
      else await api.sendDm(peerId, room.peer!.peer_id, text);
      await refresh();
    },
    [refresh],
  );

  const ack = useCallback(
    async (eventIds?: number[]) => {
      const peerId = peerRef.current;
      if (!peerId) return;
      await api.ack(peerId, eventIds);
      await refresh();
    },
    [refresh],
  );

  const react = useCallback(
    async (eventId: number, emoji: string) => {
      const peerId = peerRef.current;
      if (!peerId) return;
      await api.react(eventId, peerId, emoji);
      await refresh();
    },
    [refresh],
  );

  return (
    <Ctx.Provider value={{ ...snap, openRoom, closeRoom, refresh, sendMessage, ack, react }}>
      {children}
    </Ctx.Provider>
  );
}

export function useSync(): SyncApi {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSync outside SyncProvider');
  return v;
}
