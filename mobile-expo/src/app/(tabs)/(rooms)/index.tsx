import React, { useState } from 'react';
import { FlatList, Modal, Pressable, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { useTheme } from '../../../theme/useTheme';
import { shape, space, type } from '../../../theme/tokens';
import { useSync } from '../../../lib/store';
import { api } from '../../../lib/api';
import { timeAgo } from '../../../lib/format';
import { Avatar, EmptyState, PresenceDot, SectionLabel } from '../../../components/ui';
import type { Room } from '../../../lib/types';

// Small centered dialog for creating a room — POST /groups then auto-join.
function CreateRoomDialog({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { t } = useTheme();
  const { peerId, refresh } = useSync();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    const n = name.trim().toLowerCase().replace(/\s+/g, '-');
    if (!n || !peerId || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.createGroup(n, peerId);
      await api.joinGroup(n, peerId);
      await refresh();
      setName('');
      onClose();
    } catch (e) {
      setError(String(e).slice(0, 160));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable
        onPress={onClose}
        style={{ flex: 1, backgroundColor: t.scrim, alignItems: 'center', justifyContent: 'center', padding: space.xl }}>
        <Pressable
          onPress={() => {}}
          style={{ width: '100%', backgroundColor: t.surfaceContainerHigh, borderRadius: shape.lg, padding: space.lg, gap: space.md }}>
          <Text style={{ ...type.section, color: t.onSurface }}>New room</Text>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="room-name"
            placeholderTextColor={t.onSurfaceVariant}
            autoFocus
            autoCapitalize="none"
            style={{
              ...type.body,
              color: t.onSurface,
              backgroundColor: t.surface,
              borderRadius: shape.sm,
              paddingHorizontal: space.md,
              height: 46,
            }}
          />
          {error && <Text style={{ ...type.micro, fontWeight: '400', color: t.danger }}>{error}</Text>}
          <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: space.sm }}>
            <Pressable onPress={onClose} style={{ paddingHorizontal: 16, height: 40, justifyContent: 'center' }}>
              <Text style={{ ...type.label, color: t.onSurfaceVariant }}>Cancel</Text>
            </Pressable>
            <Pressable
              onPress={create}
              disabled={busy || !name.trim()}
              style={{
                paddingHorizontal: 18,
                height: 40,
                borderRadius: shape.full,
                backgroundColor: t.primary,
                justifyContent: 'center',
                opacity: busy || !name.trim() ? 0.6 : 1,
              }}>
              <Text style={{ ...type.label, color: t.onPrimary }}>{busy ? 'Creating…' : 'Create'}</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function RoomRow({ room, onPress }: { room: Room; onPress: () => void }) {
  const { t, identity } = useTheme();
  const c = identity(room.name);
  return (
    <Pressable
      onPress={onPress}
      android_ripple={{ color: t.outlineVariant }}
      style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingVertical: 10 }}>
      {room.kind === 'group' ? (
        <View
          style={{
            width: 40,
            height: 40,
            borderRadius: 12,
            backgroundColor: c.bg,
            alignItems: 'center',
            justifyContent: 'center',
          }}>
          <MaterialIcons name="tag" size={20} color={c.fg} />
        </View>
      ) : (
        <Avatar name={room.name} size={40} />
      )}
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text style={{ ...type.label, fontSize: 15, fontWeight: '600', color: t.onSurface }} numberOfLines={1}>
            {room.name}
          </Text>
          {room.kind === 'dm' && <PresenceDot online={room.online} size={7} />}
        </View>
        <Text style={{ ...type.label, fontWeight: '400', color: t.onSurfaceVariant, marginTop: 2 }} numberOfLines={1}>
          {room.preview || (room.kind === 'group' ? `${room.members.length} members` : room.peer?.tool ?? '')}
        </Text>
      </View>
      <Text style={{ ...type.micro, color: t.onSurfaceVariant }}>{timeAgo(room.lastAt)}</Text>
    </Pressable>
  );
}

export default function RoomsScreen() {
  const { t } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { rooms, connected } = useSync();
  const [showCreate, setShowCreate] = useState(false);
  const groups = rooms.filter((r) => r.kind === 'group');
  const dms = rooms.filter((r) => r.kind === 'dm');

  return (
    <View style={{ flex: 1, backgroundColor: t.background, paddingTop: insets.top }}>
      {/* workspace identity app bar (D-001) */}
      <View
        style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, height: 60 }}>
        <View
          style={{
            width: 34,
            height: 34,
            borderRadius: 10,
            backgroundColor: t.primaryContainer,
            alignItems: 'center',
            justifyContent: 'center',
          }}>
          <Text style={{ ...type.section, color: t.onPrimaryContainer }}>S</Text>
        </View>
        <Text style={{ ...type.title, color: t.onSurface, flex: 1 }}>Synchronize</Text>
        <Pressable onPress={() => setShowCreate(true)} hitSlop={8} style={{ padding: space.sm }}>
          <MaterialIcons name="add" size={23} color={t.onSurface} />
        </Pressable>
        <PresenceDot online={connected} size={9} />
      </View>

      <CreateRoomDialog visible={showCreate} onClose={() => setShowCreate(false)} />

      <FlatList
        data={[]}
        renderItem={null}
        ListHeaderComponent={
          <View>
            <SectionLabel>Rooms</SectionLabel>
            {groups.map((room) => (
              <RoomRow key={room.id} room={room} onPress={() => router.push(`/room/${encodeURIComponent(room.id)}`)} />
            ))}
            {groups.length === 0 && <EmptyState icon="forum" title={connected ? 'No rooms yet' : 'Connecting…'} />}
            <SectionLabel>Direct</SectionLabel>
            {dms.map((room) => (
              <RoomRow key={room.id} room={room} onPress={() => router.push(`/room/${encodeURIComponent(room.id)}`)} />
            ))}
            <View style={{ height: space.xl }} />
          </View>
        }
      />
    </View>
  );
}
