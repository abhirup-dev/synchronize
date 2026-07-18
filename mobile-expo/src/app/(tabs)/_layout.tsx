import React from 'react';
import { Tabs } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { View, Text, Pressable } from '@/tw';
import { useSync } from '@/lib/store';

// M3 navigation bar with pill active indicator + count badge (mobile.js .mnav).
// Custom JS bar: full control over the pill/badge anatomy from the reference.
const DESTS = [
  { name: 'index', icon: '⌂', label: 'Rooms' },
  { name: 'activity', icon: '◎', label: 'Activity' },
  { name: 'agents', icon: '✦', label: 'Agents' },
];

function NavBar({ state, navigation }: any) {
  const insets = useSafeAreaInsets();
  const { activity } = useSync();
  const unread = activity?.events.filter((e) => !e.acked_at).length ?? 0;
  return (
    <View className="flex-row bg-surf px-2 pt-2" style={{ paddingBottom: Math.max(insets.bottom, 12) }}>
      {DESTS.map((d) => {
        const idx = state.routes.findIndex((r: any) => r.name === d.name);
        const current = state.routes[state.index].name;
        // Rooms stays active while inside a room chat (reference behavior).
        const on = current === d.name || (d.name === 'index' && current.startsWith('room/'));
        const badge = d.name === 'activity' ? unread : 0;
        return (
          <Pressable
            key={d.name}
            className="flex-1 items-center gap-[3px]"
            onPress={() => navigation.navigate(state.routes[idx].name)}
          >
            <View
              className={`h-[30px] w-14 items-center justify-center rounded-full ${on ? 'bg-pric' : ''}`}
            >
              <Text className={`text-[15px] ${on ? 'text-onpric' : 'text-fg2'}`}>{d.icon}</Text>
              {badge > 0 ? (
                <View className="absolute -top-[3px] right-1.5 rounded-full bg-pri px-[5px] py-px">
                  <Text className="font-mono text-[8.5px] text-onpri">{badge}</Text>
                </View>
              ) : null}
            </View>
            <Text className={`font-sans-bold text-[11px] ${on ? 'text-fg' : 'text-fg2'}`}>{d.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{ headerShown: false }}
      tabBar={(props) => <NavBar {...props} />}
      backBehavior="initialRoute"
    >
      <Tabs.Screen name="index" />
      <Tabs.Screen name="activity" />
      <Tabs.Screen name="agents" />
      <Tabs.Screen name="room/[id]" options={{ href: null }} />
    </Tabs>
  );
}
