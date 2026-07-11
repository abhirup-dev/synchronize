import React, { useEffect, useMemo, useState } from 'react';
import { FlatList, KeyboardAvoidingView, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { useTheme } from '../../../../theme/useTheme';
import { shape, space, type } from '../../../../theme/tokens';
import { useSync } from '../../../../lib/store';
import { api } from '../../../../lib/api';
import { BoardView } from '../../../../components/BoardView';
import { Composer } from '../../../../components/Composer';
import { MessageRow } from '../../../../components/MessageRow';
import { Avatar, Badge, EmptyState, PresenceDot } from '../../../../components/ui';
import type { Room } from '../../../../lib/types';

// Bottom sheet with room membership + leave/archive actions.
function RoomInfoSheet({ room, visible, onClose }: { room: Room; visible: boolean; onClose: () => void }) {
  const { t, identity } = useTheme();
  const router = useRouter();
  const { peerId, refresh } = useSync();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const act = async (key: string, fn: () => Promise<unknown>, thenBack?: boolean) => {
    setBusy(key);
    setError(null);
    try {
      await fn();
      await refresh();
      onClose();
      if (thenBack) router.back();
    } catch (e) {
      setError(String(e).slice(0, 160));
    } finally {
      setBusy(null);
    }
  };

  const SheetAction = ({
    id,
    icon,
    label,
    danger,
    onPress,
  }: {
    id: string;
    icon: keyof typeof MaterialIcons.glyphMap;
    label: string;
    danger?: boolean;
    onPress: () => void;
  }) => (
    <Pressable
      onPress={onPress}
      disabled={busy !== null}
      android_ripple={{ color: t.outlineVariant }}
      style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, height: 52 }}>
      <MaterialIcons name={icon} size={20} color={danger ? t.danger : t.onSurfaceVariant} />
      <Text style={{ ...type.body, color: danger ? t.danger : t.onSurface }}>{busy === id ? '…' : label}</Text>
    </Pressable>
  );

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable onPress={onClose} style={{ flex: 1, backgroundColor: t.scrim, justifyContent: 'flex-end' }}>
        <Pressable
          onPress={() => {}}
          style={{
            backgroundColor: t.surfaceContainerHigh,
            borderTopLeftRadius: shape.lg + 6,
            borderTopRightRadius: shape.lg + 6,
            paddingTop: space.sm,
            paddingBottom: space.xl,
            maxHeight: '75%',
          }}>
          <View style={{ width: 36, height: 4, borderRadius: 4, backgroundColor: t.outline, alignSelf: 'center', marginBottom: space.sm }} />
          <Text style={{ ...type.section, color: t.onSurface, paddingHorizontal: space.lg, paddingBottom: 4 }}>
            {room.kind === 'group' ? `#${room.name}` : room.name}
          </Text>
          <Text style={{ ...type.micro, fontWeight: '400', color: t.onSurfaceVariant, paddingHorizontal: space.lg, paddingBottom: space.sm }}>
            {room.kind === 'group' ? `${room.members.length} members` : room.peer?.purpose ?? room.peer?.tool ?? ''}
          </Text>
          {error && (
            <Text style={{ ...type.micro, fontWeight: '400', color: t.danger, paddingHorizontal: space.lg, paddingBottom: space.sm }}>
              {error}
            </Text>
          )}
          <ScrollView style={{ flexGrow: 0 }}>
            {room.kind === 'group' &&
              room.members.map((m) => (
                <View
                  key={m.peer_id}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingVertical: 8 }}>
                  <Avatar name={m.alias || m.session_name || m.peer_id} size={34} />
                  <Text style={{ ...type.label, color: t.onSurface, flex: 1 }} numberOfLines={1}>
                    {m.alias || m.session_name || m.peer_id}
                  </Text>
                  {m.tool && m.tool !== 'web' && <Badge label={m.tool} bg={identity(m.tool).tint} fg={identity(m.tool).onTint} />}
                  <PresenceDot online={m.online} size={7} />
                </View>
              ))}
          </ScrollView>
          <View style={{ borderTopWidth: 1, borderTopColor: t.outlineVariant, marginTop: space.sm, paddingTop: space.xs }}>
            {room.kind === 'group' && peerId && (
              <SheetAction
                id="leave"
                icon="logout"
                label="Leave room"
                onPress={() => act('leave', () => api.leaveGroup(room.name, peerId), true)}
              />
            )}
            {room.kind === 'group' ? (
              <SheetAction
                id="archive"
                icon="inventory-2"
                label="Archive room"
                danger
                onPress={() => act('archive', () => api.archiveGroup(room.name, 'archived from mobile'), true)}
              />
            ) : (
              <SheetAction
                id="profile"
                icon="person-outline"
                label="View agent profile"
                onPress={() => {
                  onClose();
                  router.push(`/agent/${encodeURIComponent(room.peer!.peer_id)}`);
                }}
              />
            )}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

export default function RoomScreen() {
  const { t, identity } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string }>();
  const roomId = decodeURIComponent(params.id ?? '');
  const { rooms, roomEvents, state, peerId, openRoom, closeRoom, sendMessage, react, ack } = useSync();
  const [showInfo, setShowInfo] = useState(false);
  const [view, setView] = useState<'chat' | 'board'>('chat');

  const room = rooms.find((r) => r.id === roomId);
  const events = roomEvents[roomId] ?? [];
  const peers = state?.peers ?? [];

  useEffect(() => {
    openRoom(roomId);
    return () => closeRoom(roomId);
  }, [roomId, openRoom, closeRoom]);

  // main stream: hide thread replies — they live behind the thread pill
  const stream = useMemo(() => events.filter((e) => !e.parent_event_id), [events]);
  const reversed = useMemo(() => [...stream].reverse(), [stream]);

  const memberLine = useMemo(() => {
    if (!room || room.kind !== 'group') return room?.peer?.purpose ?? '';
    const names = room.members.map((m) => m.alias || m.session_name).filter(Boolean).slice(0, 3);
    return `${room.members.length} members · ${names.join(', ')}`;
  }, [room]);

  return (
    <KeyboardAvoidingView
      behavior="padding"
      style={{ flex: 1, backgroundColor: t.background, paddingTop: insets.top }}>
      {/* room header */}
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
        <Pressable onPress={() => room && setShowInfo(true)} style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            {room?.kind === 'group' && <MaterialIcons name="tag" size={16} color={room ? identity(room.name).onTint : t.onSurfaceVariant} />}
            <Text style={{ ...type.section, color: t.onSurface }} numberOfLines={1}>
              {room?.name ?? '…'}
            </Text>
          </View>
          {!!memberLine && (
            <Text style={{ ...type.micro, color: t.onSurfaceVariant }} numberOfLines={1}>
              {memberLine}
            </Text>
          )}
        </Pressable>
        <Pressable onPress={() => room && setShowInfo(true)} hitSlop={8} style={{ padding: space.sm }}>
          <MaterialIcons name="more-vert" size={20} color={t.onSurfaceVariant} />
        </Pressable>
      </View>

      {/* Chat | Board — M3 secondary tabs */}
      <View style={{ flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: t.outlineVariant }}>
        {(
          [
            { key: 'chat', label: 'Chat', icon: 'chat-bubble-outline' },
            { key: 'board', label: 'Board', icon: 'view-kanban' },
          ] as const
        ).map(({ key, label, icon }) => {
          const active = view === key;
          return (
            <Pressable
              key={key}
              onPress={() => setView(key)}
              android_ripple={{ color: t.outlineVariant }}
              style={{
                flex: 1,
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                height: 42,
                borderBottomWidth: 2,
                borderBottomColor: active ? t.primary : 'transparent',
              }}>
              <MaterialIcons name={icon} size={16} color={active ? t.primary : t.onSurfaceVariant} />
              <Text style={{ ...type.label, color: active ? t.primary : t.onSurfaceVariant }}>{label}</Text>
            </Pressable>
          );
        })}
      </View>

      {room && <RoomInfoSheet room={room} visible={showInfo} onClose={() => setShowInfo(false)} />}

      {view === 'board' ? (
        <BoardView
          events={events}
          peers={peers}
          onAck={(id) => ack([id])}
          onOpen={(e) => router.push(`/thread/${e.event_id}?room=${encodeURIComponent(roomId)}`)}
        />
      ) : reversed.length === 0 ? (
        <View style={{ flex: 1, justifyContent: 'center' }}>
          <EmptyState icon="chat-bubble-outline" title="No messages yet" />
        </View>
      ) : (
        <FlatList
          inverted
          data={reversed}
          keyExtractor={(e) => String(e.event_id)}
          renderItem={({ item }) => (
            <MessageRow
              event={item}
              peers={peers}
              selfId={peerId ?? ''}
              onReact={react}
              onAck={(id) => ack([id])}
              onOpenThread={(ev) =>
                router.push(`/thread/${ev.event_id}?room=${encodeURIComponent(roomId)}`)
              }
            />
          )}
          contentContainerStyle={{ paddingVertical: space.sm }}
        />
      )}

      {room && view === 'chat' && (
        <Composer placeholder={`Message ${room.kind === 'group' ? '#' + room.name : room.name}`} onSend={(text) => sendMessage(room, text)} />
      )}
      <View style={{ height: insets.bottom }} />
    </KeyboardAvoidingView>
  );
}
