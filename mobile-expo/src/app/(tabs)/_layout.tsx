import React from 'react';
import { Tabs } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { useTheme } from '../../theme/useTheme';
import { useSync } from '../../lib/store';

export const unstable_settings = { initialRouteName: '(rooms)' };

export default function TabsLayout() {
  const { t } = useTheme();
  const { activity } = useSync();
  const awaiting = activity?.awaiting_count ?? 0;

  const icon =
    (name: keyof typeof MaterialIcons.glyphMap) =>
    ({ color }: { color: import('react-native').ColorValue }) => (
      <MaterialIcons name={name} size={23} color={color as string} />
    );

  return (
    <Tabs
      initialRouteName="(rooms)"
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: t.primary,
        tabBarInactiveTintColor: t.onSurfaceVariant,
        tabBarStyle: {
          backgroundColor: t.surface,
          borderTopColor: t.outlineVariant,
          borderTopWidth: 1,
          elevation: 0,
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
        sceneStyle: { backgroundColor: t.background },
      }}>
      <Tabs.Screen name="(rooms)" options={{ title: 'Rooms', tabBarIcon: icon('forum') }} />
      <Tabs.Screen
        name="activity"
        options={{
          title: 'Activity',
          tabBarIcon: icon('notifications-none'),
          tabBarBadge: awaiting > 0 ? (awaiting > 99 ? '99+' : awaiting) : undefined,
          tabBarBadgeStyle: { backgroundColor: t.awaitingContainer, color: t.awaiting, fontSize: 10 },
        }}
      />
      <Tabs.Screen name="(agents)" options={{ title: 'Agents', tabBarIcon: icon('smart-toy') }} />
      <Tabs.Screen name="me" options={{ title: 'Me', tabBarIcon: icon('person-outline') }} />
    </Tabs>
  );
}
