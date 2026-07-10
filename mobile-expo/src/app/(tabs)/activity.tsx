import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { useTheme } from '../../theme/useTheme';
import { shape, space, type } from '../../theme/tokens';
import { useSync } from '../../lib/store';
import { displayName, timeAgo } from '../../lib/format';
import { AckButton, Avatar, EmptyState, FilterChip } from '../../components/ui';
import type { SyncEvent } from '../../lib/types';

type Filter = 'all' | 'awaiting' | 'mentions' | 'rooms';
const PREVIEW_ROWS = 4;

export default function ActivityScreen() {
  const { t, identity } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { activity, state, ack } = useSync();
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  // undefined = preview, 'full' = all rows, false = collapsed
  const [expanded, setExpanded] = useState<Record<string, false | 'full' | undefined>>({});

  const peers = activity?.peers ?? state?.peers ?? [];
  const events = activity?.events ?? [];
  const awaitingCount = activity?.awaiting_count ?? 0;
  const mentionEvents = useMemo(() => events.filter((e) => !!e.mentions_json), [events]);

  const filtered = useMemo(() => {
    let list = events;
    if (filter === 'awaiting') list = list.filter((e) => e.awaiting);
    if (filter === 'mentions') list = mentionEvents;
    if (filter === 'rooms') list = list.filter((e) => e.group_id != null);
    const q = query.trim().toLowerCase();
    if (q) {
      list = list.filter((e) => {
        const sender = displayName(peers.find((p) => p.peer_id === e.sender_peer_id)?.session_name, e.sender_peer_id);
        return (
          e.body.toLowerCase().includes(q) ||
          sender.toLowerCase().includes(q) ||
          (e.group_name ?? '').toLowerCase().includes(q)
        );
      });
    }
    return list;
  }, [events, filter, query, mentionEvents, peers]);

  // group event bursts by room (D-003)
  const groups = useMemo(() => {
    const map = new Map<string, { name: string; isDm: boolean; events: SyncEvent[] }>();
    for (const e of filtered) {
      const key = e.group_id != null ? `g:${e.group_id}` : `dm:${e.sender_peer_id}`;
      if (!map.has(key)) {
        const dmName = displayName(peers.find((p) => p.peer_id === e.sender_peer_id)?.session_name, e.sender_peer_id);
        map.set(key, { name: e.group_name ?? dmName, isDm: e.group_id == null, events: [] });
      }
      map.get(key)!.events.push(e);
    }
    return [...map.entries()].map(([key, g]) => ({
      key,
      ...g,
      awaiting: g.events.filter((e) => e.awaiting).length,
    }));
  }, [filtered, peers]);

  const openEvent = (e: SyncEvent) => {
    const roomId = e.group_id != null ? `group:${e.group_id}` : `dm:${e.sender_peer_id}`;
    if (e.parent_event_id) {
      router.push(`/thread/${e.parent_event_id}?room=${encodeURIComponent(roomId)}`);
    } else if ((e.reply_count ?? 0) > 0) {
      router.push(`/thread/${e.event_id}?room=${encodeURIComponent(roomId)}`);
    } else {
      router.push(`/room/${encodeURIComponent(roomId)}`);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: t.background, paddingTop: insets.top }}>
      {/* fixed summary header (D-002) */}
      <View style={{ paddingHorizontal: space.lg, paddingTop: space.md }}>
        <Text style={{ ...type.title, color: t.onSurface }}>Activity</Text>
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', marginTop: 2 }}>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
            <Text style={{ ...type.display, color: t.onSurface }}>{awaitingCount}</Text>
            <Text style={{ ...type.body, color: t.onSurfaceVariant }}>awaiting</Text>
            {awaitingCount > 0 && (
              <View style={{ width: 7, height: 7, borderRadius: 7, backgroundColor: t.awaiting }} />
            )}
          </View>
          <Pressable
            onPress={() => ack()}
            disabled={awaitingCount === 0}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
              paddingHorizontal: 18,
              height: 42,
              borderRadius: shape.full,
              backgroundColor: awaitingCount > 0 ? t.primaryContainer : t.surfaceContainer,
            }}>
            <MaterialIcons
              name="done-all"
              size={17}
              color={awaitingCount > 0 ? t.onPrimaryContainer : t.onSurfaceVariant}
            />
            <Text style={{ ...type.label, color: awaitingCount > 0 ? t.onPrimaryContainer : t.onSurfaceVariant }}>
              Ack all
            </Text>
          </Pressable>
        </View>

        <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.md }}>
          <FilterChip label="All" count={events.length} active={filter === 'all'} onPress={() => setFilter('all')} />
          <FilterChip
            label="Awaiting"
            count={awaitingCount}
            emphasis
            active={filter === 'awaiting'}
            onPress={() => setFilter('awaiting')}
          />
          <FilterChip
            label="Mentions"
            count={mentionEvents.length}
            active={filter === 'mentions'}
            onPress={() => setFilter('mentions')}
          />
          <FilterChip
            label="Rooms"
            count={events.filter((e) => e.group_id != null).length}
            active={filter === 'rooms'}
            onPress={() => setFilter('rooms')}
          />
        </View>

        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: space.sm,
            backgroundColor: t.surfaceContainer,
            borderRadius: shape.full,
            paddingHorizontal: space.md,
            height: 44,
            marginTop: space.md,
          }}>
          <MaterialIcons name="search" size={18} color={t.onSurfaceVariant} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search activity"
            placeholderTextColor={t.onSurfaceVariant}
            style={{ flex: 1, ...type.body, color: t.onSurface, paddingVertical: 0 }}
          />
        </View>
      </View>

      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.md, paddingBottom: space.xl }}>
        {groups.length === 0 && (
          <EmptyState icon="inbox" title="Nothing here" body="Agent activity that needs you will show up in this inbox." />
        )}
        {groups.map((g) => {
          const mode = expanded[g.key];
          const isOpen = mode !== false;
          const shown = !isOpen ? [] : mode === 'full' ? g.events : g.events.slice(0, PREVIEW_ROWS);
          const hidden = g.events.length - shown.length;
          const c = identity(g.name);
          return (
            <View
              key={g.key}
              style={{ backgroundColor: t.surfaceContainer, borderRadius: shape.lg, overflow: 'hidden' }}>
              {/* room group header */}
              <Pressable
                onPress={() => setExpanded((prev) => ({ ...prev, [g.key]: isOpen ? false : undefined }))}
                style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.md }}>
                <View
                  style={{
                    width: 30,
                    height: 30,
                    borderRadius: 9,
                    backgroundColor: c.bg,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}>
                  <MaterialIcons name={g.isDm ? 'person' : 'tag'} size={16} color={c.fg} />
                </View>
                <Text style={{ ...type.section, color: t.onSurface, flexShrink: 1 }} numberOfLines={1}>
                  {g.name}
                </Text>
                <Text style={{ ...type.micro, color: t.onSurfaceVariant }}>{g.events.length}</Text>
                <View style={{ flex: 1 }} />
                {g.awaiting > 0 && (
                  <View
                    style={{
                      backgroundColor: t.awaitingContainer,
                      borderRadius: shape.full,
                      paddingHorizontal: 10,
                      paddingVertical: 3,
                    }}>
                    <Text style={{ ...type.micro, color: t.awaiting }}>{g.awaiting} awaiting</Text>
                  </View>
                )}
                <MaterialIcons name={isOpen ? 'expand-less' : 'expand-more'} size={20} color={t.onSurfaceVariant} />
              </Pressable>

              {shown.map((e) => {
                const sender = displayName(
                  peers.find((p) => p.peer_id === e.sender_peer_id)?.session_name,
                  e.sender_peer_id,
                );
                return (
                  <Pressable
                    key={e.event_id}
                    onPress={() => openEvent(e)}
                    android_ripple={{ color: t.outlineVariant }}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: space.sm,
                      paddingHorizontal: space.md,
                      paddingVertical: 9,
                      borderTopWidth: 1,
                      borderTopColor: t.outlineVariant,
                    }}>
                    <View
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: 6,
                        backgroundColor: e.awaiting ? t.primary : 'transparent',
                      }}
                    />
                    <Avatar name={sender} size={32} />
                    <View style={{ flex: 1 }}>
                      <Text style={{ ...type.label, color: t.onSurface }} numberOfLines={1}>
                        {sender}
                      </Text>
                      <Text style={{ ...type.micro, fontWeight: '400', color: t.onSurfaceVariant, marginTop: 1 }} numberOfLines={1}>
                        {e.body.replace(/\s+/g, ' ')}
                      </Text>
                    </View>
                    <Text style={{ ...type.micro, color: t.onSurfaceVariant }}>{timeAgo(e.created_at)}</Text>
                    {e.awaiting ? <AckButton compact onPress={() => ack([e.event_id])} /> : null}
                  </Pressable>
                );
              })}

              {hidden > 0 && (
                <Pressable
                  onPress={() => setExpanded((prev) => ({ ...prev, [g.key]: 'full' }))}
                  style={{ padding: space.md, borderTopWidth: 1, borderTopColor: t.outlineVariant }}>
                  <Text style={{ ...type.label, color: t.primary }}>+ {hidden} more</Text>
                </Pressable>
              )}
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}
