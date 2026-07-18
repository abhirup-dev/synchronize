import type { ActivityFeed, Peer, Room, SyncEvent } from './types';

export function unreadEvents(activity: ActivityFeed | null): SyncEvent[] {
  return activity?.events.filter((e) => !e.acked_at) ?? [];
}

export function unreadForRoom(room: Room, activity: ActivityFeed | null): number {
  const un = unreadEvents(activity);
  if (room.kind === 'group')
    return un.filter((e) => `group:${e.group_id}` === room.id).length;
  return un.filter((e) => !e.group_id && `dm:${e.sender_peer_id}` === room.id).length;
}

export function workingCount(peers: Peer[] | undefined): number {
  return (peers ?? []).filter((p) => p.online && !p.archived_at && p.tool !== 'web').length;
}

// Room id for an activity event, so taps can deep-link into the room.
export function roomIdFor(e: SyncEvent): string {
  return e.group_id ? `group:${e.group_id}` : `dm:${e.sender_peer_id}`;
}
