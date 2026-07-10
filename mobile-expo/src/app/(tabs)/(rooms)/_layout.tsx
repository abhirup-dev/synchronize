import React from 'react';
import { Stack } from 'expo-router';
import { useTheme } from '../../../theme/useTheme';

export default function RoomsStack() {
  const { t } = useTheme();
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: t.background } }} />;
}
