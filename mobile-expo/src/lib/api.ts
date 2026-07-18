import type { ActivityFeed, WebState } from './types';

// Reached from the emulator via: adb reverse tcp:58405 tcp:58405
// ponytail: in-memory base URL, editable on the Me screen; persist later if needed.
let baseUrl = 'http://127.0.0.1:58405';

export function getBaseUrl() {
  return baseUrl;
}

export function setBaseUrl(url: string) {
  baseUrl = url.replace(/\/$/, '');
}

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(baseUrl + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`${method} ${path} -> ${res.status} ${text.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  registerSession: () => req<{ peer: { peer_id: string } }>('POST', '/web/session', {}),

  summaryState: (peerId: string) =>
    req<WebState>('GET', `/web/state?limit=500&peer_id=${encodeURIComponent(peerId)}`),

  roomState: (peerId: string, roomId: string) =>
    req<WebState>(
      'GET',
      `/web/state?room=${encodeURIComponent(roomId)}&limit=500&peer_id=${encodeURIComponent(peerId)}`,
    ),

  sendGroup: (groupName: string, senderPeerId: string, message: string, inReplyTo?: number) =>
    req('POST', `/groups/${encodeURIComponent(groupName)}/messages`, {
      sender_peer_id: senderPeerId,
      message,
      ...(inReplyTo ? { in_reply_to: inReplyTo } : {}),
    }),

  sendDm: (senderPeerId: string, recipientPeerId: string, message: string) =>
    req('POST', '/dm', {
      sender_peer_id: senderPeerId,
      recipient_peer_id: recipientPeerId,
      message,
    }),

  activity: (peerId: string, awaitingOnly = false) =>
    req<ActivityFeed>(
      'GET',
      `/activity/${encodeURIComponent(peerId)}?limit=200${awaitingOnly ? '&filter=awaiting' : ''}`,
    ),

  ack: (peerId: string, eventIds?: number[]) =>
    req('POST', `/peers/${encodeURIComponent(peerId)}/inbox/ack`, eventIds ? { event_ids: eventIds } : {}),

  react: (eventId: number, peerId: string, emoji: string) =>
    req('POST', `/events/${eventId}/reactions`, { peer_id: peerId, emoji }),

  archivedSessions: () => req<{ sessions?: unknown[] } & Record<string, unknown>>('GET', '/archive/sessions'),

  archiveSession: (peerId: string, reason?: string) =>
    req('POST', '/archive/session', { peer_id: peerId, ...(reason ? { reason } : {}) }),

  resumeSession: (peerId: string) => req('POST', '/resume/session', { peer_id: peerId }),

  archiveGroup: (group: string, reason?: string) =>
    req('POST', '/archive/group', { group, ...(reason ? { reason } : {}) }),

  resumeGroup: (group: string) => req('POST', '/resume/group', { group }),

  spawn: (opts: {
    tool: string;
    profile_name?: string;
    name?: string;
    repo?: string;
    group?: string;
    model?: string;
    thinking?: string;
  }) => req<{ launchId: string; peerId: string; sessionName: string }>('POST', '/agent-sessions/launch', opts),

  setModel: (peerId: string, model: string) =>
    req('POST', '/agent-sessions/set-model', { peer_id: peerId, model }),

  createGroup: (name: string, creatorPeerId: string, description?: string) =>
    req<{ group: { group_id: number; name: string } }>('POST', '/groups', {
      name,
      creator_peer_id: creatorPeerId,
      ...(description ? { description } : {}),
    }),

  joinGroup: (group: string, peerId: string) =>
    req('POST', `/groups/${encodeURIComponent(group)}/join`, { peer_id: peerId }),

  leaveGroup: (group: string, peerId: string) =>
    req('POST', `/groups/${encodeURIComponent(group)}/leave`, { peer_id: peerId }),
};

// Direct URL for media bytes (images render straight off the daemon).
export function mediaUrl(mediaId: number) {
  return `${baseUrl}/media/${mediaId}`;
}
