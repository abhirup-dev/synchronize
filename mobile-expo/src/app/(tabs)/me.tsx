import React, { useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Constants from 'expo-constants';
import { useTheme } from '../../theme/useTheme';
import { shape, space, type } from '../../theme/tokens';
import { useSync } from '../../lib/store';
import { getBaseUrl, setBaseUrl } from '../../lib/api';
import { Card, PresenceDot, SectionLabel } from '../../components/ui';

function Row({ label, value }: { label: string; value: string }) {
  const { t } = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        justifyContent: 'space-between',
        gap: space.md,
        paddingHorizontal: space.md,
        paddingVertical: 10,
        borderTopWidth: 1,
        borderTopColor: t.outlineVariant,
      }}>
      <Text style={{ ...type.label, fontWeight: '400', color: t.onSurfaceVariant }}>{label}</Text>
      <Text style={{ ...type.label, color: t.onSurface, flexShrink: 1, textAlign: 'right' }} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

export default function MeScreen() {
  const { t, mode } = useTheme();
  const insets = useSafeAreaInsets();
  const { connected, error, peerId, state, rooms, agents, activity, refresh } = useSync();
  const [urlDraft, setUrlDraft] = useState(getBaseUrl());

  return (
    <View style={{ flex: 1, backgroundColor: t.background, paddingTop: insets.top }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.lg, height: 60 }}>
        <Text style={{ ...type.title, color: t.onSurface, flex: 1 }}>Me</Text>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: space.xl }}>
        <SectionLabel>Daemon connection</SectionLabel>
        <Card style={{ marginHorizontal: space.lg }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.md }}>
            <PresenceDot online={connected} size={9} />
            <Text style={{ ...type.label, color: connected ? t.success : t.awaiting }}>
              {connected ? 'Connected' : 'Disconnected'}
            </Text>
          </View>
          {!connected && error && (
            <Text style={{ ...type.micro, fontWeight: '400', color: t.danger, paddingHorizontal: space.md, paddingBottom: space.sm }} numberOfLines={3}>
              {error}
            </Text>
          )}
          <View style={{ flexDirection: 'row', gap: space.sm, padding: space.md, borderTopWidth: 1, borderTopColor: t.outlineVariant }}>
            <TextInput
              value={urlDraft}
              onChangeText={setUrlDraft}
              autoCapitalize="none"
              autoCorrect={false}
              style={{
                flex: 1,
                ...type.mono,
                color: t.onSurface,
                backgroundColor: t.codeBg,
                borderRadius: shape.sm,
                paddingHorizontal: space.md,
                height: 42,
              }}
            />
            <Pressable
              onPress={() => {
                setBaseUrl(urlDraft.trim());
                refresh();
              }}
              style={{
                paddingHorizontal: 14,
                height: 42,
                borderRadius: shape.sm,
                backgroundColor: t.primary,
                alignItems: 'center',
                justifyContent: 'center',
              }}>
              <Text style={{ ...type.label, color: t.onPrimary }}>Apply</Text>
            </Pressable>
          </View>
          <Row label="Peer id" value={peerId ?? '—'} />
          <Row label="Cursor" value={state ? String(state.cursor) : '—'} />
        </Card>

        <SectionLabel>Workspace</SectionLabel>
        <Card style={{ marginHorizontal: space.lg }}>
          <Row label="Rooms" value={String(rooms.filter((r) => r.kind === 'group').length)} />
          <Row label="Direct peers" value={String(rooms.filter((r) => r.kind === 'dm').length)} />
          <Row label="Agents" value={String(agents.length)} />
          <Row label="Awaiting acks" value={String(activity?.awaiting_count ?? 0)} />
        </Card>

        <SectionLabel>App</SectionLabel>
        <Card style={{ marginHorizontal: space.lg }}>
          <Row label="Theme" value={mode === 'dark' ? 'Dark (system)' : 'Light (system)'} />
          <Row label="Version" value={Constants.expoConfig?.version ?? '1.0.0'} />
        </Card>
      </ScrollView>
    </View>
  );
}
