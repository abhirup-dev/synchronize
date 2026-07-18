import React, { useEffect, useMemo, useRef } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { KeyboardAvoidingView, FlatList } from 'react-native';
import { View, Text, Pressable, SafeAreaView } from '@/tw';
import { MTop } from '@/components/ui';
import { SigilChip } from '@/components/sigil';
import { MessageRow } from '@/components/message-row';
import { Composer } from '@/components/composer';
import { useSync } from '@/lib/store';
import type { SyncEvent } from '@/lib/types';

// Chat view (design.md §6): app bar with mono sub-line + avatar cluster,
// tonal bubbles, docked pill composer. Top-level replies only; threads
// open as a bottom sheet.
export default function RoomScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const roomId = decodeURIComponent(id ?? '');
  const router = useRouter();
  const sync = useSync();
  const { rooms, roomEvents, state, peerId, openRoom, closeRoom, sendMessage, ack } = sync;
  const listRef = useRef<FlatList<SyncEvent>>(null);

  const room = rooms.find((r) => r.id === roomId);
  const events = useMemo(
    () =>
      (roomEvents[roomId] ?? []).filter(
        (e) => (e.type === 'message' || e.type?.includes('message') || e.body) &&
          !e.reply_to_event_id && !e.parent_event_id &&
          !e.body?.startsWith('{'),
      ),
    [roomEvents, roomId],
  );
  const peers = useMemo(() => new Map((state?.peers ?? []).map((p) => [p.peer_id, p])), [state]);

  useEffect(() => {
    openRoom(roomId);
    return () => closeRoom(roomId);
  }, [roomId, openRoom, closeRoom]);

  // ponytail: no LayoutAnimation — it corrupts borderRadius rendering of
  // unrelated views on Android (nav pill went square after visiting a chat).

  // Ack this room's unread activity when the chat is open.
  useEffect(() => {
    const un = (sync.activity?.events ?? []).filter(
      (e) => !e.acked_at && (e.group_id ? `group:${e.group_id}` === roomId : `dm:${e.sender_peer_id}` === roomId),
    );
    if (un.length) ack(un.map((e) => e.event_id)).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, sync.activity?.events?.length]);

  const members = room?.members ?? [];
  const online = members.filter((m) => m.online).length;
  const sub =
    room?.kind === 'group'
      ? `${members.length} MEMBERS · ${online} ONLINE`
      : room?.peer?.online
        ? 'ONLINE'
        : 'OFFLINE';
  const cluster = members.filter((m) => m.tool !== 'web').slice(0, 3);

  return (
    <SafeAreaView edges={['top']} className="flex-1 bg-bg">
      <MTop
        title={room ? (room.kind === 'group' ? `# ${room.name}` : room.name) : roomId}
        sub={sub}
        onBack={() => (router.canGoBack() ? router.back() : router.navigate('/'))}
        right={
          cluster.length ? (
            <Pressable className="flex-row" onPress={() => router.navigate('/agents')}>
              {cluster.map((m, i) => (
                <View
                  key={m.peer_id}
                  className="rounded-full border-2 border-bg"
                  style={{ marginLeft: i === 0 ? 0 : -7 }}
                >
                  <SigilChip id={m.peer_id} tool={m.tool} name={m.session_name} size={26} />
                </View>
              ))}
            </Pressable>
          ) : undefined
        }
      />
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        <FlatList<SyncEvent>
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingTop: 6, paddingBottom: 8 }}
          ref={listRef}
          data={events}
          keyExtractor={(e: SyncEvent) => String(e.event_id)}
          renderItem={({ item }) => (
            <MessageRow
              event={item}
              sender={peers.get(item.sender_peer_id)}
              self={item.sender_peer_id === peerId}
              roomId={roomId}
            />
          )}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
          ListEmptyComponent={
            <Text className="px-5 pt-10 text-center font-mono text-[11px] text-fg3">
              NO MESSAGES YET
            </Text>
          }
        />
        {room ? (
          <Composer
            placeholder="Message… @ tags an agent"
            onSend={(t) => sendMessage(room, t)}
          />
        ) : null}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
