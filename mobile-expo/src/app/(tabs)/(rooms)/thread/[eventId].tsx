import React, { useEffect, useMemo } from 'react';
import { FlatList, KeyboardAvoidingView, Pressable, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { useTheme } from '../../../../theme/useTheme';
import { space, type } from '../../../../theme/tokens';
import { useSync } from '../../../../lib/store';
import { Composer } from '../../../../components/Composer';
import { MessageRow } from '../../../../components/MessageRow';

export default function ThreadScreen() {
  const { t } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ eventId: string; room: string }>();
  const roomId = decodeURIComponent(params.room ?? '');
  const rootId = Number(params.eventId);
  const { rooms, roomEvents, state, peerId, openRoom, closeRoom, sendMessage, react, ack } = useSync();

  const room = rooms.find((r) => r.id === roomId);
  const events = roomEvents[roomId] ?? [];
  const peers = state?.peers ?? [];

  useEffect(() => {
    openRoom(roomId);
    return () => closeRoom(roomId);
  }, [roomId, openRoom, closeRoom]);

  const thread = useMemo(() => {
    const root = events.find((e) => e.event_id === rootId);
    const replies = events.filter((e) => e.parent_event_id === rootId);
    return root ? [root, ...replies] : replies;
  }, [events, rootId]);
  const replyCount = Math.max(thread.length - 1, 0);

  return (
    <KeyboardAvoidingView
      behavior="padding"
      style={{ flex: 1, backgroundColor: t.background, paddingTop: insets.top }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: space.sm,
          paddingHorizontal: space.sm,
          height: 56,
          borderBottomWidth: 1,
          borderBottomColor: t.outlineVariant,
        }}>
        <Pressable onPress={() => router.back()} hitSlop={8} style={{ padding: space.sm }}>
          <MaterialIcons name="arrow-back" size={22} color={t.onSurface} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={{ ...type.section, color: t.onSurface }}>Thread</Text>
          <Text style={{ ...type.micro, color: t.onSurfaceVariant }}>
            {replyCount} {replyCount === 1 ? 'reply' : 'replies'}
            {room ? ` · ${room.kind === 'group' ? '#' + room.name : room.name}` : ''}
          </Text>
        </View>
      </View>

      <FlatList
        data={thread}
        keyExtractor={(e) => String(e.event_id)}
        renderItem={({ item }) => (
          <MessageRow event={item} peers={peers} selfId={peerId ?? ''} onReact={react} onAck={(id) => ack([id])} isThreadRoot />
        )}
        contentContainerStyle={{ paddingVertical: space.sm }}
      />

      {room && <Composer placeholder="Reply in thread" onSend={(text) => sendMessage(room, text, rootId)} />}
      <View style={{ height: insets.bottom }} />
    </KeyboardAvoidingView>
  );
}
