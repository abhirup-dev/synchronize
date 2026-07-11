import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { useTheme } from '../../theme/useTheme';
import { row, shape, space, type } from '../../theme/tokens';
import { useSync } from '../../lib/store';
import { displayName, timeAgo } from '../../lib/format';
import { AckButton, Avatar, Divider, EmptyState, FilterChip } from '../../components/ui';
import type { SyncEvent } from '../../lib/types';

type Filter = 'all' | 'awaiting' | 'mentions' | 'rooms';
const PREVIEW_ROWS = 5;

type ActivityGroup = {
  key: string;
  name: string;
  isDm: boolean;
  events: SyncEvent[];
  awaiting: number;
};

export default function ActivityScreen() {
  const { t, identity } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const { activity, state, ack } = useSync();
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  // undefined = preview, 'full' = all rows, false = collapsed
  const [expanded, setExpanded] = useState<Record<string, false | 'full' | undefined>>({});

  // adaptive: dense single column on phones, 2–3 balanced columns on tablets
  const cols = width >= 1000 ? 3 : width >= 640 ? 2 : 1;
  const wide = cols > 1;

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
  const groups = useMemo<ActivityGroup[]>(() => {
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

  // balance group cards across columns by visible row count (greedy)
  const columns = useMemo(() => {
    const buckets: ActivityGroup[][] = Array.from({ length: cols }, () => []);
    const loads = new Array<number>(cols).fill(0);
    for (const g of groups) {
      const rows = Math.min(g.events.length, PREVIEW_ROWS) + 2;
      const i = loads.indexOf(Math.min(...loads));
      buckets[i].push(g);
      loads[i] += rows;
    }
    return buckets;
  }, [groups, cols]);

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

  const searchBox = (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.sm,
        backgroundColor: t.surfaceContainer,
        borderRadius: shape.full,
        paddingHorizontal: space.md,
        height: 40,
        flex: wide ? 1 : undefined,
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
  );

  const filterChips = (
    <>
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
    </>
  );

  // Flat inbox idiom (Slack Activity / GitHub Mobile): collapsible text section
  // headers, edge-to-edge two-line rows, inset dividers. No cards, no tints.
  const renderGroup = (g: ActivityGroup) => {
    const mode = expanded[g.key];
    const isOpen = mode !== false;
    const shown = !isOpen ? [] : mode === 'full' ? g.events : g.events.slice(0, PREVIEW_ROWS);
    const hidden = g.events.length - shown.length;
    const c = identity(g.name);
    return (
      <View key={g.key}>
        {/* room section header — text, not a box */}
        <Pressable
          onPress={() => setExpanded((prev) => ({ ...prev, [g.key]: isOpen ? false : undefined }))}
          android_ripple={{ color: t.outlineVariant }}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: space.sm,
            paddingHorizontal: space.lg,
            height: 44,
          }}>
          <View
            style={{
              width: 22,
              height: 22,
              borderRadius: 7,
              backgroundColor: c.bg,
              alignItems: 'center',
              justifyContent: 'center',
            }}>
            <MaterialIcons name={g.isDm ? 'person' : 'tag'} size={13} color={c.fg} />
          </View>
          <Text style={{ ...type.label, fontWeight: '600', color: t.onSurface, flexShrink: 1 }} numberOfLines={1}>
            {g.name}
          </Text>
          <Text style={{ ...type.micro, fontWeight: '400', color: t.onSurfaceVariant }}>{g.events.length}</Text>
          <View style={{ flex: 1 }} />
          {g.awaiting > 0 && (
            <Text style={{ ...type.micro, color: t.awaiting }}>{g.awaiting} awaiting</Text>
          )}
          <MaterialIcons name={isOpen ? 'expand-less' : 'expand-more'} size={18} color={t.onSurfaceVariant} />
        </Pressable>

        {shown.map((e, i) => {
          const sender = displayName(
            peers.find((p) => p.peer_id === e.sender_peer_id)?.session_name,
            e.sender_peer_id,
          );
          return (
            <View key={e.event_id}>
              {i > 0 && <Divider inset={row.textInset} />}
              <Pressable
                onPress={() => openEvent(e)}
                android_ripple={{ color: t.outlineVariant }}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: space.md,
                  paddingHorizontal: space.lg,
                  minHeight: row.two - 4,
                  paddingVertical: 8,
                }}>
                <View style={{ position: 'relative' }}>
                  <Avatar name={sender} size={36} />
                  {e.awaiting && (
                    <View
                      style={{
                        position: 'absolute',
                        top: -2,
                        right: -2,
                        width: 9,
                        height: 9,
                        borderRadius: 9,
                        backgroundColor: t.awaiting,
                        borderWidth: 1.5,
                        borderColor: t.background,
                      }}
                    />
                  )}
                </View>
                <View style={{ flex: 1, gap: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: space.sm }}>
                    <Text
                      style={{
                        fontSize: 14,
                        fontWeight: e.awaiting ? '700' : '500',
                        color: t.onSurface,
                        flexShrink: 1,
                      }}
                      numberOfLines={1}>
                      {sender}
                    </Text>
                    {!!e.mentions_json && (
                      <Text style={{ ...type.micro, color: t.mention }}>@</Text>
                    )}
                    {e.parent_event_id != null ? (
                      <MaterialIcons name="subdirectory-arrow-right" size={12} color={t.onSurfaceVariant} />
                    ) : (e.reply_count ?? 0) > 0 ? (
                      <Text style={{ ...type.micro, color: t.onSurfaceVariant }}>
                        {e.reply_count} repl{(e.reply_count ?? 0) === 1 ? 'y' : 'ies'}
                      </Text>
                    ) : null}
                    <View style={{ flex: 1 }} />
                    <Text style={{ ...type.micro, fontWeight: '400', color: t.onSurfaceVariant }}>
                      {timeAgo(e.created_at)}
                    </Text>
                  </View>
                  <Text
                    style={{ ...type.sub, color: t.onSurfaceVariant }}
                    numberOfLines={1}>
                    {e.body.replace(/\s+/g, ' ')}
                  </Text>
                </View>
                {e.awaiting ? <AckButton compact onPress={() => ack([e.event_id])} /> : null}
              </Pressable>
            </View>
          );
        })}

        {hidden > 0 && (
          <Pressable
            onPress={() => setExpanded((prev) => ({ ...prev, [g.key]: 'full' }))}
            android_ripple={{ color: t.outlineVariant }}
            style={{ paddingLeft: row.textInset, paddingVertical: 10 }}>
            <Text style={{ ...type.label, color: t.primary }}>Show {hidden} more</Text>
          </Pressable>
        )}
        <Divider />
      </View>
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: t.background, paddingTop: insets.top }}>
      {/* compact command-center header (D-002, densified) */}
      <View style={{ paddingHorizontal: space.lg, paddingTop: space.md }}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Text style={{ ...type.title, color: t.onSurface }}>Activity</Text>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 5, marginLeft: space.md }}>
            <Text style={{ fontSize: 26, fontWeight: '700', letterSpacing: -0.5, color: awaitingCount > 0 ? t.awaiting : t.onSurface }}>
              {awaitingCount}
            </Text>
            <Text style={{ ...type.micro, fontWeight: '400', color: t.onSurfaceVariant }}>awaiting</Text>
          </View>
          <View style={{ flex: 1 }} />
          <Pressable
            onPress={() => ack()}
            disabled={awaitingCount === 0}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
              paddingHorizontal: 16,
              height: 38,
              borderRadius: shape.full,
              backgroundColor: awaitingCount > 0 ? t.primaryContainer : t.surfaceContainer,
            }}>
            <MaterialIcons
              name="done-all"
              size={16}
              color={awaitingCount > 0 ? t.onPrimaryContainer : t.onSurfaceVariant}
            />
            <Text style={{ ...type.label, color: awaitingCount > 0 ? t.onPrimaryContainer : t.onSurfaceVariant }}>
              Ack all
            </Text>
          </Pressable>
        </View>

        {wide ? (
          // tablet: filters + search share one row
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.md }}>
            {filterChips}
            <View style={{ width: space.sm }} />
            {searchBox}
          </View>
        ) : (
          <>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: space.sm }}
              style={{ marginTop: space.md, flexGrow: 0 }}>
              {filterChips}
            </ScrollView>
            <View style={{ marginTop: space.sm }}>{searchBox}</View>
          </>
        )}
      </View>

      <ScrollView contentContainerStyle={{ paddingTop: space.sm, paddingBottom: space.xl }}>
        {groups.length === 0 && (
          <EmptyState icon="inbox" title="Nothing here" body="Agent activity that needs you will show up in this inbox." />
        )}
        {wide ? (
          // tablet: same flat rows flowing into columns split by vertical hairlines
          <View style={{ flexDirection: 'row', alignItems: 'stretch' }}>
            {columns.map((bucket, i) => (
              <View
                key={i}
                style={{
                  flex: 1,
                  borderLeftWidth: i > 0 ? 1 : 0,
                  borderLeftColor: t.outlineVariant,
                }}>
                {bucket.map(renderGroup)}
              </View>
            ))}
          </View>
        ) : (
          <View>{groups.map(renderGroup)}</View>
        )}
      </ScrollView>
    </View>
  );
}
