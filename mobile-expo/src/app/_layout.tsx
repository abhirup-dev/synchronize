import React, { useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import { useTheme } from '../theme/useTheme';
import { SyncProvider } from '../lib/store';

export default function RootLayout() {
  const { t, mode } = useTheme();
  // System chrome contract: the root view (visible behind status/navigation
  // bars in edge-to-edge) must follow the active theme, not the launch theme.
  useEffect(() => {
    SystemUI.setBackgroundColorAsync(t.background);
  }, [t.background]);
  return (
    <SyncProvider>
      <StatusBar style={mode === 'dark' ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: t.background },
        }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="spawn" options={{ presentation: 'modal' }} />
      </Stack>
    </SyncProvider>
  );
}
