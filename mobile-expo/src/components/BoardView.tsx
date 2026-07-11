import React, { useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useTheme } from '../theme/useTheme';
import { shape, space, type } from '../theme/tokens';
import { displayName, timeAgo } from '../lib/format';
import { Avatar } from './ui';
import type { Peer, SyncEvent } from '../lib/types';

// Room work board — three lanes derived from message state (no separate
// backend): Awaiting (needs a human ack), In thread (live discussion),
// Resolved (acked). Mobile pattern: one lane per swipe page with next-lane
// peek and lane chips as pager; lanes sit side-by-side on wide windows.

const LANES = [
  { key: 'awaiting', label: 'Awaiting', icon: 'notifications-active' },
  { key: 'active', label: 'In thread', icon: 'forum' },
  { key: 'done', label: 'Resolved', icon: 'check-circle' },
] as const;
type LaneKey = (typeof LANES)[number]['key'];

function laneOf(e: SyncEvent): LaneKey | null {
  if (e.parent_event_id != null) return null; // cards are thread roots
  if (e.body.startsWith('{')) return null; // roster/system JSON payloads
  if (e.awaiting) return 'awaiting';
  if ((e.reply_count ?? 0) > 0) return 'active';
  if (e.acked_at || (e.acked_count ?? 0) > 0) return 'done';
  return null;
}

export function BoardView({
  events,
  peers,
  onOpen,
  onAck,
}: {
  events: SyncEvent[];
  peers: Peer[];
  onOpen: (e: SyncEvent) => void;
  onAck: (eventId: number) => void;
}) {
  const { t } = useTheme();
  const { width } = useWindowDimensions();
  const [page, setPage] = useState(0);
  const pagerRef = useRef<ScrollView>(null);

  const wide = width >= 700;
  const laneW = Math.min(Math.round(width * 0.84), 340);
  const step = laneW + space.md;

  const lanes = useMemo(() => {
    const map: Record<LaneKey, SyncEvent[]> = { awaiting: [], active: [], done: [] };
    for (const e of events) {
      const lane = laneOf(e);
      if (lane) map[lane].push(e);
    }
    map.awaiting.reverse();
    map.active.reverse();
    map.done.reverse();
    return map;
  }, [events]);

  const laneColor = (key: LaneKey) =>
    key === 'awaiting'
      ? { fg: t.awaiting, bg: t.awaitingContainer, onBg: t.onAwaitingContainer }
      : key === 'active'
        ? { fg: t.primary, bg: t.primaryContainer, onBg: t.onPrimaryContainer }
        : { fg: t.success, bg: t.successContainer, onBg: t.onSuccessContainer };

  const renderCard = (e: SyncEvent) => {
    const sender = displayName(peers.find((p) => p.peer_id === e.sender_peer_id)?.session_name, e.sender_peer_id);
    return (
      <Pressable
        key={e.event_id}
        onPress={() => onOpen(e)}
        android_ripple={{ color: t.outlineVariant }}
        style={{
          backgroundColor: t.surfaceContainer,
          borderRadius: shape.md,
          padding: space.md,
          gap: 6,
        }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
          <Avatar name={sender} size={22} />
          <Text style={{ ...type.label, color: t.onSurface, flexShrink: 1 }} numberOfLines={1}>
            {sender}
          </Text>
          <View style={{ flex: 1 }} />
          <Text style={{ ...type.micro, fontSize: 10.5, color: t.onSurfaceVariant }}>{timeAgo(e.created_at)}</Text>
        </View>
        <Text style={{ ...type.body, fontSize: 13.5, lineHeight: 19, color: t.onSurface }} numberOfLines={3}>
          {e.body.replace(/\s+/g, ' ')}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
          {(e.reply_count ?? 0) > 0 && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
              <MaterialIcons name="forum" size={13} color={t.primary} />
              <Text style={{ ...type.micro, color: t.primary }}>{e.reply_count}</Text>
            </View>
          )}
          {!!e.mentions_json && (
            <View style={{ backgroundColor: t.mentionContainer, borderRadius: shape.xs, paddingHorizontal: 5, paddingVertical: 1 }}>
              <Text style={{ ...type.micro, fontSize: 10, color: t.onMentionContainer }}>@</Text>
            </View>
          )}
          <View style={{ flex: 1 }} />
          {e.awaiting ? (
            <Pressable
              onPress={() => onAck(e.event_id)}
              hitSlop={8}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 4,
                paddingHorizontal: 10,
                height: 28,
                borderRadius: shape.full,
                backgroundColor: t.primaryContainer,
              }}>
              <MaterialIcons name="check" size={13} color={t.onPrimaryContainer} />
              <Text style={{ ...type.micro, color: t.onPrimaryContainer }}>Ack</Text>
            </Pressable>
          ) : e.acked_at || (e.acked_count ?? 0) > 0 ? (
            <MaterialIcons name="check-circle" size={15} color={t.success} />
          ) : null}
        </View>
      </Pressable>
    );
  };

  const renderLane = (lane: (typeof LANES)[number], w?: number) => {
    const c = laneColor(lane.key);
    const items = lanes[lane.key];
    return (
      <View
        key={lane.key}
        style={{
          width: w,
          flex: w ? undefined : 1,
          backgroundColor: t.surface,
          borderRadius: shape.lg,
          borderWidth: 1,
          borderColor: t.outlineVariant,
          overflow: 'hidden',
        }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: space.md, paddingVertical: 10, backgroundColor: c.bg }}>
          <MaterialIcons name={lane.icon} size={15} color={c.onBg} />
          <Text style={{ ...type.label, color: c.onBg }}>{lane.label}</Text>
          <Text style={{ ...type.micro, color: c.onBg, opacity: 0.8 }}>{items.length}</Text>
        </View>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: space.sm, gap: space.sm, flexGrow: 1 }}>
          {items.length === 0 ? (
            <View style={{ alignItems: 'center', paddingVertical: space.xl }}>
              <Text style={{ ...type.micro, fontWeight: '400', color: t.onSurfaceVariant }}>Nothing here</Text>
            </View>
          ) : (
            items.map(renderCard)
          )}
        </ScrollView>
      </View>
    );
  };

  if (wide) {
    return (
      <View style={{ flex: 1, flexDirection: 'row', gap: space.md, padding: space.md }}>
        {LANES.map((l) => renderLane(l))}
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      {/* lane pager chips */}
      <View style={{ flexDirection: 'row', gap: space.sm, paddingHorizontal: space.md, paddingVertical: space.sm }}>
        {LANES.map((l, i) => {
          const c = laneColor(l.key);
          const active = page === i;
          return (
            <Pressable
              key={l.key}
              onPress={() => {
                setPage(i);
                pagerRef.current?.scrollTo({ x: i * step, animated: true });
              }}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 5,
                paddingHorizontal: 12,
                height: 32,
                borderRadius: shape.full,
                backgroundColor: active ? c.bg : 'transparent',
                borderWidth: 1,
                borderColor: active ? c.bg : t.outlineVariant,
              }}>
              <MaterialIcons name={l.icon} size={13} color={active ? c.onBg : t.onSurfaceVariant} />
              <Text style={{ ...type.micro, color: active ? c.onBg : t.onSurfaceVariant }}>
                {l.label} {lanes[l.key].length}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <ScrollView
        ref={pagerRef}
        style={{ flex: 1 }}
        horizontal
        showsHorizontalScrollIndicator={false}
        snapToInterval={step}
        decelerationRate="fast"
        onMomentumScrollEnd={(ev) => setPage(Math.round(ev.nativeEvent.contentOffset.x / step))}
        contentContainerStyle={{ paddingHorizontal: space.md, paddingBottom: space.md, gap: space.md }}>
        {LANES.map((l) => renderLane(l, laneW))}
      </ScrollView>
    </View>
  );
}
