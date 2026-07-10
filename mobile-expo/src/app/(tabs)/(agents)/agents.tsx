import React from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { useTheme } from '../../../theme/useTheme';
import { shape, space, type } from '../../../theme/tokens';
import { useSync } from '../../../lib/store';
import { timeAgo } from '../../../lib/format';
import { Avatar, Badge, EmptyState, PresenceDot } from '../../../components/ui';

export default function AgentsScreen() {
  const { t } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { agents } = useSync();

  return (
    <View style={{ flex: 1, backgroundColor: t.background, paddingTop: insets.top }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.lg, height: 60 }}>
        <Text style={{ ...type.title, color: t.onSurface, flex: 1 }}>Agents</Text>
        <Pressable
          onPress={() => router.push('/archive')}
          hitSlop={8}
          style={{ padding: space.sm }}>
          <MaterialIcons name="inventory-2" size={21} color={t.onSurfaceVariant} />
        </Pressable>
        <Pressable
          onPress={() => router.push('/spawn')}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 4,
            paddingHorizontal: 14,
            height: 38,
            borderRadius: shape.full,
            backgroundColor: t.primary,
            marginLeft: space.sm,
          }}>
          <MaterialIcons name="add" size={17} color={t.onPrimary} />
          <Text style={{ ...type.label, color: t.onPrimary }}>Spawn</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: space.xl }}>
        {agents.length === 0 && (
          <EmptyState icon="smart-toy" title="No agents" body="Spawn an agent to start delegating work." />
        )}
        {agents.map((a) => (
          <Pressable
            key={a.peer.peer_id}
            onPress={() => router.push(`/agent/${encodeURIComponent(a.peer.peer_id)}`)}
            android_ripple={{ color: t.outlineVariant }}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: space.md,
              paddingHorizontal: space.lg,
              paddingVertical: 11,
            }}>
            <Avatar name={a.peer.session_name || a.peer.peer_id} size={42} />
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text style={{ ...type.label, fontSize: 15, fontWeight: '600', color: t.onSurface }} numberOfLines={1}>
                  {a.peer.session_name || a.peer.peer_id}
                </Text>
                <Badge label={a.peer.tool} />
                <PresenceDot online={a.peer.online} size={7} />
              </View>
              <Text style={{ ...type.label, fontWeight: '400', color: t.onSurfaceVariant, marginTop: 2 }} numberOfLines={1}>
                {a.runtime?.model ? `${a.runtime.model} · ` : ''}
                {a.rooms.length > 0 ? a.rooms.map((r) => `#${r}`).join(' ') : a.peer.purpose || 'no rooms'}
              </Text>
            </View>
            <Text style={{ ...type.micro, color: t.onSurfaceVariant }}>{timeAgo(a.peer.last_activity_at)}</Text>
            <MaterialIcons name="chevron-right" size={20} color={t.outline} />
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}
