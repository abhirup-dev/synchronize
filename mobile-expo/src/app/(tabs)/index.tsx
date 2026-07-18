import React from 'react';
import { useRouter } from 'expo-router';
import { View, Text, Pressable, ScrollView, SafeAreaView } from '@/tw';
import { MTop } from '@/components/ui';
import { SigilChip } from '@/components/sigil';
import { useSync } from '@/lib/store';
import { unreadForRoom, workingCount } from '@/lib/derive';
import type { Room } from '@/lib/types';

// Rooms home (design.md §6): room rows with # tile, bold name,
// one-line last-message preview, accent unread badge.
export default function RoomsScreen() {
  const router = useRouter();
  const sync = useSync();
  const { rooms, activity, state, connected, error } = sync;
  const unreadTotal = rooms.reduce((n, r) => n + unreadForRoom(r, activity), 0);
  const working = workingCount(state?.peers);
  const cluster = (sync.agents ?? []).filter((a) => a.peer.online).slice(0, 3);

  const row = (room: Room) => {
    const unread = unreadForRoom(room, activity);
    return (
      <Pressable
        className="flex-row items-center gap-3 px-5 py-[11px] active:bg-surf"
        onPress={() => router.push(`/room/${encodeURIComponent(room.id)}`)}
      >
        {room.kind === 'group' ? (
          <View className="h-[42px] w-[42px] items-center justify-center rounded-[15px] bg-surf">
            <Text className="font-sans-bold text-[17px] text-fg2">#</Text>
          </View>
        ) : (
          <SigilChip id={room.peer!.peer_id} tool={room.peer!.tool} name={room.name} size={42} />
        )}
        <View className="min-w-0 flex-1">
          <Text className="font-sans-bold text-[14.5px] text-fg" numberOfLines={1}>
            {room.name}
          </Text>
          {room.preview ? (
            <Text className="mt-0.5 font-sans text-[12px] text-fg2" numberOfLines={1}>
              {room.preview.replace(/[`*]/g, '')}
            </Text>
          ) : null}
        </View>
        {unread > 0 ? (
          <View className="rounded-full bg-pri px-2 py-[3px]">
            <Text className="font-mono-bold text-[10px] text-onpri">{unread}</Text>
          </View>
        ) : null}
      </Pressable>
    );
  };

  return (
    <SafeAreaView edges={['top']} className="flex-1 bg-bg">
      <MTop
        menu
        title="Rooms"
        sub={`${rooms.length} ROOMS · ${unreadTotal} UNREAD · ● ${working} WORKING`}
        right={
          cluster.length ? (
            <Pressable className="flex-row" onPress={() => router.navigate('/agents')}>
              {cluster.map((a, i) => (
                <View
                  key={a.peer.peer_id}
                  className="rounded-full border-2 border-bg"
                  style={{ marginLeft: i === 0 ? 0 : -7 }}
                >
                  <SigilChip id={a.peer.peer_id} tool={a.peer.tool} name={a.peer.session_name} size={26} />
                </View>
              ))}
            </Pressable>
          ) : undefined
        }
      />
      {!connected && error ? (
        <View className="mx-4 mb-2 rounded-2xl bg-surf px-4 py-3">
          <Text className="font-mono text-[10px] text-danger" numberOfLines={2}>
            DAEMON UNREACHABLE · {error}
          </Text>
        </View>
      ) : null}
      <ScrollView className="flex-1" contentContainerClassName="pt-2 pb-2">
        {rooms.map((r) => (
          <React.Fragment key={r.id}>{row(r)}</React.Fragment>
        ))}
        {rooms.length === 0 ? (
          <Text className="px-5 pt-10 text-center font-mono text-[11px] text-fg3">
            NO ROOMS YET
          </Text>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
