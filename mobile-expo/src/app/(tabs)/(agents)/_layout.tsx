import React from 'react';
import { Stack } from 'expo-router';
import { useTheme } from '../../../theme/useTheme';

export const unstable_settings = { initialRouteName: 'agents' };

export default function AgentsStack() {
  const { t } = useTheme();
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: t.background } }} />;
}
