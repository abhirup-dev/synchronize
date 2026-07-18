import React, { useMemo, useState } from 'react';
import { useRouter } from 'expo-router';
import { View, Text, Pressable, ScrollView, SafeAreaView } from '@/tw';
import { MTop, MTabs } from '@/components/ui';
import { SigilChip } from '@/components/sigil';
import { BodyText } from '@/components/message-row';
import { useSync } from '@/lib/store';
import { roomIdFor, unreadEvents, workingCount } from '@/lib/derive';
import { nameColor } from '@/theme/tokens';
import { useTheme } from '@/theme/use-theme';
import { displayName, timeAgo } from '@/lib/format';
import type { SyncEvent } from '@/lib/types';

// Activity view (design.md §4.4/§6): grouped per-room cards, M3 primary tabs
// All / Mentions / Awaiting. Awaiting ≈ unread (reference approximation).
export default function ActivityScreen() {
  const router = useRouter();
  const { dark } = useTheme();
  const { activity, state, peerId } = useSync();
  const [filter, setFilter] = useState('all');

  const peers = useMemo(
    () => new Map((state?.peers ?? []).map((p) => [p.peer_id, p])),
    [state],
  );
  const groupNames = useMemo(
    () => new Map((state?.groups ?? []).map((g) => [g.group_id, g.name])),
    [state],
  );

  const all = activity?.events ?? [];
  const unread = unreadEvents(activity);
  const mentions = all.filter((e) => peerId && e.mentions_json?.includes(peerId));
  const shown = filter === 'mentions' ? mentions : filter === 'awaiting' ? unread : all;

  const groups = useMemo(() => {
    const m = new Map<string, { label: string; dm?: string; items: SyncEvent[] }>();
    for (const e of shown) {
      const key = roomIdFor(e);
      const label = e.group_id
        ? `#${e.group_name ?? groupNames.get(e.group_id) ?? e.group_id}`
        : displayName(peers.get(e.sender_peer_id)?.session_name, e.sender_peer_id);
      const g = m.get(key) ?? { label, dm: e.group_id ? undefined : e.sender_peer_id, items: [] };
      g.items.push(e);
      m.set(key, g);
    }
    return [...m.entries()];
  }, [shown, groupNames, peers]);

  return (
    <SafeAreaView edges={['top']} className="flex-1 bg-bg">
      <MTop
        title="Activity"
        sub={`${all.length} UPDATES · ${unread.length} AWAITING YOU · ● ${workingCount(state?.peers)} WORKING`}
      />
      <MTabs
        tabs={[
          { key: 'all', label: 'All', count: all.length },
          { key: 'mentions', label: 'Mentions', count: mentions.length },
          { key: 'awaiting', label: 'Awaiting', count: unread.length },
        ]}
        active={filter}
        onChange={setFilter}
      />
      <ScrollView className="flex-1" contentContainerClassName="pt-2 pb-2">
        {groups.map(([roomId, g]) => (
          <View key={roomId} className="mx-3 mb-2.5 overflow-hidden rounded-[22px] bg-surf">
            <Pressable
              className="flex-row items-center gap-2 px-4 pb-1 pt-3"
              onPress={() => router.push(`/room/${encodeURIComponent(roomId)}`)}
            >
              {g.dm ? (
                <SigilChip id={g.dm} tool={peers.get(g.dm)?.tool} name={g.label} size={24} />
              ) : null}
              <Text className="font-sans-bold text-[14px] text-fg">{g.label}</Text>
              <Text className="font-mono text-[9.5px] text-fg3">{g.items.length}</Text>
              {g.items.some((e) => !e.acked_at) ? (
                <View className="ml-auto rounded-full bg-pric px-2.5 py-[3px]">
                  <Text className="font-sans-bold text-[10.5px] text-onpric">
                    {g.items.filter((e) => !e.acked_at).length} awaiting
                  </Text>
                </View>
              ) : null}
            </Pressable>
            {g.items.slice(0, 6).map((e) => {
              const sender = peers.get(e.sender_peer_id);
              const un = !e.acked_at;
              return (
                <Pressable
                  key={e.event_id}
                  className="flex-row items-start gap-2.5 px-4 py-2"
                  onPress={() => router.push(`/room/${encodeURIComponent(roomIdFor(e))}`)}
                >
                  <Pressable onPress={() => router.push(`/agent/${encodeURIComponent(e.sender_peer_id)}`)}>
                    <SigilChip
                      id={e.sender_peer_id}
                      tool={sender?.tool}
                      name={sender?.session_name}
                      size={26}
                    />
                  </Pressable>
                  <View className="min-w-0 flex-1">
                    <View className="flex-row items-baseline gap-1.5">
                      <Text
                        className="font-sans-bold text-[12px]"
                        style={{ color: nameColor(e.sender_peer_id, dark) }}
                      >
                        {displayName(sender?.session_name, e.sender_peer_id)}
                      </Text>
                      <Text className="ml-auto font-mono text-[9px] text-fg3">
                        {timeAgo(e.created_at)}
                      </Text>
                    </View>
                    <Text
                      className={`font-sans text-[12.5px] leading-[1.45] ${un ? 'text-fg' : 'text-fg2'}`}
                      numberOfLines={2}
                    >
                      {e.body}
                    </Text>
                  </View>
                  {un ? <View className="mt-1.5 h-[7px] w-[7px] rounded-full bg-pri" /> : null}
                </Pressable>
              );
            })}
            <View className="h-2" />
          </View>
        ))}
        {groups.length === 0 ? (
          <Text className="px-5 pt-10 text-center font-mono text-[11px] text-fg3">
            NOTHING HERE YET
          </Text>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
