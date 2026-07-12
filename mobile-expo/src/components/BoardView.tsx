import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useTheme } from '../theme/useTheme';
import { row, shape, space, type } from '../theme/tokens';
import { displayName, timeAgo } from '../lib/format';
import { AckButton, Avatar, Divider, type AckState } from './ui';
import type { Peer, SyncEvent } from '../lib/types';

// Room work board — three lanes derived from message state (no separate
// backend): Awaiting (needs a human ack), In thread (live discussion),
// Resolved (acked).
//
// Phone (combined-audit Board direction): segmented lane chips + ONE
// full-width lane rendered as a flat list. Opens on the first non-empty lane;
// empty lanes are compact states, never full-height containers. Wide windows
// keep three side-by-side lanes with quiet text headers.

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
  onAck: (eventId: number) => void | Promise<void>;
}) {
  const { t } = useTheme();
  const { width } = useWindowDimensions();
  const wide = width >= 700;
  const [picked, setPicked] = useState<LaneKey | null>(null); // null = auto
  const [acks, setAcks] = useState<Record<number, AckState>>({});

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

  // open on the first non-empty lane until the user picks one
  const selected: LaneKey = picked ?? LANES.find((l) => lanes[l.key].length > 0)?.key ?? 'awaiting';
  const allEmpty = LANES.every((l) => lanes[l.key].length === 0);

  const ackOne = async (id: number) => {
    setAcks((p) => ({ ...p, [id]: 'pending' }));
    try {
      await onAck(id);
      setAcks((p) => ({ ...p, [id]: 'done' }));
    } catch {
      setAcks((p) => ({ ...p, [id]: 'error' }));
    }
  };

  const laneColor = (key: LaneKey) =>
    key === 'awaiting'
      ? { fg: t.awaiting, bg: t.awaitingContainer, onBg: t.onAwaitingContainer }
      : key === 'active'
        ? { fg: t.primary, bg: t.primaryContainer, onBg: t.onPrimaryContainer }
        : { fg: t.success, bg: t.successContainer, onBg: t.onSuccessContainer };

  // Flat two-line row (lane is a list, not a card stack)
  const renderRow = (e: SyncEvent, i: number) => {
    const sender = displayName(peers.find((p) => p.peer_id === e.sender_peer_id)?.session_name, e.sender_peer_id);
    return (
      <View key={e.event_id}>
        {i > 0 && <Divider inset={row.textInset} />}
        <Pressable
          onPress={() => onOpen(e)}
          android_ripple={{ color: t.outlineVariant }}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: space.md,
            paddingHorizontal: space.lg,
            minHeight: row.two,
            paddingVertical: 10,
          }}>
          <Avatar name={sender} size={36} />
          <View style={{ flex: 1, gap: 2 }}>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: space.sm }}>
              <Text style={{ fontSize: 14, fontWeight: '600', color: t.onSurface, flexShrink: 1 }} numberOfLines={1}>
                {sender}
              </Text>
              {(e.reply_count ?? 0) > 0 && (
                <Text style={{ ...type.micro, fontWeight: '400', color: t.onSurfaceVariant }}>
                  {e.reply_count} repl{(e.reply_count ?? 0) === 1 ? 'y' : 'ies'}
                </Text>
              )}
              {!!e.mentions_json && <Text style={{ ...type.micro, color: t.mention }}>@</Text>}
              <View style={{ flex: 1 }} />
              <Text style={{ ...type.micro, fontWeight: '400', color: t.onSurfaceVariant }}>{timeAgo(e.created_at)}</Text>
            </View>
            <Text style={{ ...type.sub, color: t.onSurfaceVariant }} numberOfLines={2}>
              {e.body.replace(/\s+/g, ' ')}
            </Text>
          </View>
          {e.awaiting || acks[e.event_id] ? (
            <AckButton compact state={acks[e.event_id] ?? 'idle'} onPress={() => ackOne(e.event_id)} />
          ) : e.acked_at || (e.acked_count ?? 0) > 0 ? (
            <MaterialIcons name="check-circle" size={16} color={t.success} />
          ) : null}
        </Pressable>
      </View>
    );
  };

  const chips = (
    <View style={{ flexDirection: 'row', gap: space.sm, paddingHorizontal: space.lg, paddingVertical: space.sm }}>
      {LANES.map((l) => {
        const c = laneColor(l.key);
        const active = selected === l.key;
        const n = lanes[l.key].length;
        return (
          <Pressable
            key={l.key}
            onPress={() => setPicked(l.key)}
            hitSlop={{ top: 8, bottom: 8 }}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            accessibilityLabel={`${l.label}, ${n}`}
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
            <Text style={{ ...type.label, color: active ? c.onBg : t.onSurfaceVariant }}>
              {l.label}
              {n > 0 ? ` ${n}` : ''}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );

  if (wide) {
    return (
      <View style={{ flex: 1, flexDirection: 'row' }}>
        {LANES.map((l, i) => {
          const items = lanes[l.key];
          const c = laneColor(l.key);
          return (
            <View
              key={l.key}
              style={{ flex: 1, borderLeftWidth: i > 0 ? 1 : 0, borderLeftColor: t.outlineVariant }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: space.lg, paddingVertical: 10 }}>
                <MaterialIcons name={l.icon} size={14} color={c.fg} />
                <Text style={{ ...type.label, fontWeight: '600', color: t.onSurface }}>{l.label}</Text>
                <Text style={{ ...type.micro, fontWeight: '400', color: t.onSurfaceVariant }}>{items.length}</Text>
              </View>
              <ScrollView style={{ flex: 1 }}>
                {items.length === 0 ? (
                  <Text style={{ ...type.sub, color: t.onSurfaceVariant, paddingHorizontal: space.lg, paddingVertical: space.md }}>
                    Nothing here
                  </Text>
                ) : (
                  items.map(renderRow)
                )}
              </ScrollView>
            </View>
          );
        })}
      </View>
    );
  }

  if (allEmpty) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.sm, padding: space.xl }}>
        <MaterialIcons name="check-circle" size={40} color={t.success} />
        <Text style={{ ...type.section, color: t.onSurface }}>Board is clear</Text>
        <Text style={{ ...type.sub, color: t.onSurfaceVariant, textAlign: 'center' }}>
          Nothing awaiting, in thread, or recently resolved in this room.
        </Text>
      </View>
    );
  }

  const items = lanes[selected];
  return (
    <View style={{ flex: 1 }}>
      {chips}
      <Divider />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: space.xl }}>
        {items.length === 0 ? (
          <Text style={{ ...type.sub, color: t.onSurfaceVariant, paddingHorizontal: space.lg, paddingVertical: space.lg }}>
            Nothing {selected === 'awaiting' ? 'awaiting your ack' : selected === 'active' ? 'in thread' : 'resolved yet'} —
            check the other lanes above.
          </Text>
        ) : (
          items.map(renderRow)
        )}
      </ScrollView>
    </View>
  );
}
