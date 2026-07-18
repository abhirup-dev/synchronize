import React, { useEffect, useMemo } from 'react';
import { useLocalSearchParams } from 'expo-router';
import { View, Text, ScrollView } from '@/tw';
import { MessageRow } from '@/components/message-row';
import { Composer } from '@/components/composer';
import { useSync } from '@/lib/store';

// Thread bottom sheet (design.md §6): grab handle + scrim come from the
// native formSheet presentation; content reuses small message rows.
export default function ThreadSheet() {
  const { eventId, room: roomParam } = useLocalSearchParams<{ eventId: string; room: string }>();
  const roomId = decodeURIComponent(roomParam ?? '');
  const id = Number(eventId);
  const { rooms, roomEvents, state, peerId, sendMessage, openRoom, closeRoom } = useSync();

  useEffect(() => {
    openRoom(roomId);
    return () => closeRoom(roomId);
  }, [roomId, openRoom, closeRoom]);

  const room = rooms.find((r) => r.id === roomId);
  const events = roomEvents[roomId] ?? [];
  const parent = events.find((e) => e.event_id === id);
  const replies = useMemo(
    () => events.filter((e) => e.reply_to_event_id === id || e.parent_event_id === id),
    [events, id],
  );
  const peers = useMemo(() => new Map((state?.peers ?? []).map((p) => [p.peer_id, p])), [state]);

  return (
    <View className="flex-1 bg-bg">
      <View className="flex-row items-baseline gap-2 px-5 pb-2.5 pt-3">
        <Text className="font-sans-bold text-[16px] text-fg">Thread</Text>
        <Text className="font-mono text-[9.5px] text-fg3">
          {room ? `${room.kind === 'group' ? '#' : ''}${room.name} · ` : ''}
          {replies.length} {replies.length === 1 ? 'REPLY' : 'REPLIES'}
        </Text>
      </View>
      <ScrollView className="flex-1">
        {parent ? (
          <MessageRow
            event={parent}
            sender={peers.get(parent.sender_peer_id)}
            self={parent.sender_peer_id === peerId}
            small
            showThreadChip={false}
          />
        ) : null}
        {replies.map((e) => (
          <MessageRow
            key={e.event_id}
            event={e}
            sender={peers.get(e.sender_peer_id)}
            self={e.sender_peer_id === peerId}
            small
            showThreadChip={false}
          />
        ))}
      </ScrollView>
      {room ? (
        <Composer placeholder="Reply in thread…" onSend={(t) => sendMessage(room, t, id)} />
      ) : null}
    </View>
  );
}
