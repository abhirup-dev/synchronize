import React from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useTheme } from '../theme/useTheme';
import { SyncProvider } from '../lib/store';

export default function RootLayout() {
  const { t, mode } = useTheme();
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
