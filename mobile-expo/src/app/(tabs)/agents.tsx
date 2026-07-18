import React from 'react';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { View, Text, Pressable, ScrollView } from '@/tw';
import { MTop, MButton, StatusPill, statusOf } from '@/components/ui';
import { SigilChip } from '@/components/sigil';
import { useSync } from '@/lib/store';
import { nameColor } from '@/theme/tokens';
import { useTheme } from '@/theme/use-theme';
import { displayName } from '@/lib/format';
import type { Agent } from '@/lib/types';

// Agents roster (design.md §6): 40px identity, name in hue, mono
// harness·model·role kicker, tonal status pill + primary Spawn button.
export default function AgentsScreen() {
  const router = useRouter();
  const { dark } = useTheme();
  const { agents } = useSync();
  const working = agents.filter((a) => statusOf(a.peer) === 'working').length;

  const row = (a: Agent) => {
    const status = statusOf(a.peer);
    const name = displayName(a.peer.session_name, a.peer.peer_id);
    const kicker = [a.peer.tool, a.runtime?.model, a.rooms[0]]
      .filter(Boolean)
      .join(' · ');
    return (
      <Pressable
        className={`flex-row items-center gap-3 px-5 py-2.5 active:bg-surf ${status === 'archived' ? 'opacity-50' : ''}`}
        onPress={() => router.push(`/agent/${encodeURIComponent(a.peer.peer_id)}`)}
      >
        <SigilChip id={a.peer.peer_id} tool={a.peer.tool} name={name} size={40} />
        <View className="min-w-0 flex-1">
          <Text
            className="font-sans-bold text-[14.5px]"
            style={{ color: nameColor(a.peer.peer_id, dark) }}
            numberOfLines={1}
          >
            {name}
          </Text>
          <Text className="mt-0.5 font-mono text-[9px] uppercase tracking-wide text-fg3" numberOfLines={1}>
            {kicker}
          </Text>
        </View>
        <StatusPill status={status} />
      </Pressable>
    );
  };

  return (
    <SafeAreaView edges={['top']} className="flex-1 bg-bg">
      <MTop title="Agents" sub={`${agents.length} AGENTS · ${working} WORKING`} />
      <ScrollView className="flex-1" contentContainerClassName="pt-2 pb-2">
        {agents.map((a) => (
          <React.Fragment key={a.peer.peer_id}>{row(a)}</React.Fragment>
        ))}
        {agents.length === 0 ? (
          <Text className="px-5 pt-10 text-center font-mono text-[11px] text-fg3">NO AGENTS</Text>
        ) : null}
        <View className="mx-4 my-3.5 self-start">
          <MButton label="+ Spawn agent" variant="primary" onPress={() => router.push('/spawn')} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
