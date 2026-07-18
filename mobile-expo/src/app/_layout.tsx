import '../global.css';
import React, { useEffect } from 'react';
import { Stack } from 'expo-router/stack';
import { StatusBar } from 'expo-status-bar';
import { NavigationBar } from 'expo-navigation-bar';
import * as SplashScreen from 'expo-splash-screen';
import {
  useFonts,
  InstrumentSans_400Regular,
  InstrumentSans_500Medium,
  InstrumentSans_600SemiBold,
  InstrumentSans_700Bold,
} from '@expo-google-fonts/instrument-sans';
import {
  JetBrainsMono_400Regular,
  JetBrainsMono_500Medium,
  JetBrainsMono_700Bold,
} from '@expo-google-fonts/jetbrains-mono';
import { colorScheme, VariableContextProvider } from 'react-native-css';
import { SyncProvider } from '@/lib/store';
import { useTheme } from '@/theme/use-theme';

SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
  const { c, dark } = useTheme();
  const [loaded] = useFonts({
    InstrumentSans_400Regular,
    InstrumentSans_500Medium,
    InstrumentSans_600SemiBold,
    InstrumentSans_700Bold,
    JetBrainsMono_400Regular,
    JetBrainsMono_500Medium,
    JetBrainsMono_700Bold,
  });

  useEffect(() => {
    if (loaded) SplashScreen.hideAsync().catch(() => {});
  }, [loaded]);

  // Keep rn-css's scheme in lockstep with the JS palette (media queries etc).
  useEffect(() => {
    colorScheme.set(dark ? 'dark' : 'light');
  }, [dark]);

  if (!loaded) return null;

  // Mode-aware token vars: rn-css doesn't re-evaluate :root vars declared
  // under @media blocks, so the active palette is provided from JS here.
  const vars: Record<string, string> = { ...c, ok: '#52c48b', danger: '#d05050' };

  return (
    <SyncProvider>
      <VariableContextProvider value={vars}>
      <StatusBar style={dark ? 'light' : 'dark'} />
      <NavigationBar style="auto" />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: c.bg },
        }}
      >
        <Stack.Screen name="(tabs)" />
        <Stack.Screen
          name="thread/[eventId]"
          options={{
            presentation: 'formSheet',
            sheetGrabberVisible: true,
            sheetAllowedDetents: [0.78],
            sheetCornerRadius: 28,
            contentStyle: { backgroundColor: c.bg },
          }}
        />
        <Stack.Screen
          name="agent/[peerId]"
          options={{
            presentation: 'formSheet',
            sheetGrabberVisible: true,
            sheetAllowedDetents: 'fitToContents',
            sheetCornerRadius: 28,
            contentStyle: { backgroundColor: c.bg },
          }}
        />
        <Stack.Screen
          name="menu"
          options={{
            presentation: 'formSheet',
            sheetGrabberVisible: true,
            sheetAllowedDetents: 'fitToContents',
            sheetCornerRadius: 28,
            contentStyle: { backgroundColor: c.bg },
          }}
        />
        <Stack.Screen
          name="spawn"
          options={{
            presentation: 'formSheet',
            sheetGrabberVisible: true,
            sheetAllowedDetents: [0.85],
            sheetCornerRadius: 28,
            contentStyle: { backgroundColor: c.bg },
          }}
        />
      </Stack>
      </VariableContextProvider>
    </SyncProvider>
  );
}
