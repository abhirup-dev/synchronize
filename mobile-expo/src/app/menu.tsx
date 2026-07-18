import React, { useState } from 'react';
import { Appearance, useColorScheme } from 'react-native';
import { View, Text, ScrollView, TextInput } from '@/tw';
import { Section, KV, Chip, toast } from '@/components/ui';
import { useSync } from '@/lib/store';
import { getBaseUrl, setBaseUrl } from '@/lib/api';
import { useTheme } from '@/theme/use-theme';

// Overflow menu sheet: appearance switch + daemon connection details.
// ponytail: theme override is session-scoped via Appearance.setColorScheme;
// persist with AsyncStorage if it ever needs to survive restarts.
export default function MenuSheet() {
  const { c } = useTheme();
  const scheme = useColorScheme();
  const sync = useSync();
  const [override, setOverride] = useState<'system' | 'light' | 'dark'>('system');
  const [url, setUrl] = useState(getBaseUrl());

  const setMode = (mode: 'system' | 'light' | 'dark') => {
    setOverride(mode);
    Appearance.setColorScheme((mode === 'system' ? null : mode) as 'light' | 'dark');
  };

  const applyUrl = async () => {
    setBaseUrl(url.trim());
    setUrl(getBaseUrl());
    try {
      await sync.refresh();
      toast('Reconnected to daemon');
    } catch {
      toast('Daemon unreachable at that URL');
    }
  };

  const s = sync.state;

  return (
    <ScrollView className="flex-1 bg-bg" contentContainerClassName="px-5 pb-8">
      <View className="flex-row items-baseline gap-2 pb-1 pt-4">
        <Text className="font-sans-bold text-[18px] text-fg">Settings</Text>
        <Text className="font-mono text-[9.5px] uppercase text-fg3">SIGIL · SYNCHRONIZE</Text>
      </View>

      <Section label="Appearance" />
      <View className="flex-row flex-wrap gap-1.5">
        {(['system', 'light', 'dark'] as const).map((m) => (
          <Chip key={m} label={m} on={override === m} onPress={() => setMode(m)} />
        ))}
      </View>
      <Text className="mt-1.5 font-mono text-[9px] uppercase tracking-wide text-fg3">
        ACTIVE · {scheme ?? 'dark'}
      </Text>

      <Section label="Daemon connection" />
      <View className="flex-row items-center gap-2 pb-1">
        <View
          className="h-[8px] w-[8px] rounded-full"
          style={{ backgroundColor: sync.connected ? '#52c48b' : '#d05050' }}
        />
        <Text className="font-sans-bold text-[13px] text-fg">
          {sync.connected ? 'Connected' : 'Disconnected'}
        </Text>
      </View>
      <KV k="Peer" v={sync.peerId} />
      <KV k="Agents" v={s ? String(s.peers.filter((p) => p.tool !== 'web').length) : undefined} />
      <KV k="Groups" v={s ? String(s.groups.length) : undefined} />
      <KV k="Cursor" v={s ? String(s.cursor) : undefined} />
      <KV
        k="Awaiting you"
        v={sync.activity ? String(sync.activity.events.filter((e) => !e.acked_at).length) : undefined}
      />
      {sync.error ? <KV k="Last error" v={sync.error.slice(0, 120)} mono={false} /> : null}

      <Section label="Daemon base URL" />
      <TextInput
        className="rounded-full bg-surf px-[18px] py-3 font-mono text-[12px] text-fg"
        value={url}
        onChangeText={setUrl}
        autoCapitalize="none"
        autoCorrect={false}
        onSubmitEditing={applyUrl}
        returnKeyType="done"
        placeholderTextColor={c.fg3}
      />
      <Text className="mt-1.5 font-mono text-[9px] uppercase tracking-wide text-fg3">
        EMULATOR REACHES THE HOST VIA adb reverse
      </Text>
    </ScrollView>
  );
}
