import React, { useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Constants from 'expo-constants';
import { getThemePref, setThemePref, useTheme, type ThemePref } from '../../theme/useTheme';
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

const THEME_OPTIONS: { value: ThemePref; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

// One true segmented control (M3 connected buttons) — a single joined track,
// not three pills floating inside a card.
function ThemeToggle() {
  const { t } = useTheme();
  const [pref, setPref] = useState(getThemePref());
  return (
    <View
      style={{
        flexDirection: 'row',
        margin: space.md,
        padding: 3,
        borderRadius: shape.full,
        backgroundColor: t.surfaceContainerHigh,
      }}>
      {THEME_OPTIONS.map((o) => {
        const active = pref === o.value;
        return (
          <Pressable
            key={o.value}
            onPress={() => {
              setThemePref(o.value);
              setPref(o.value);
            }}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            accessibilityLabel={o.value === 'system' ? 'Match device appearance' : o.label}
            style={{
              flex: 1,
              height: 36,
              borderRadius: shape.full,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: active ? t.primaryContainer : 'transparent',
            }}>
            <Text style={{ ...type.label, color: active ? t.onPrimaryContainer : t.onSurfaceVariant }}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export default function MeScreen() {
  const { t, mode } = useTheme();
  const insets = useSafeAreaInsets();
  const { connected, error, peerId, state, rooms, agents, activity, refresh } = useSync();
  const [urlDraft, setUrlDraft] = useState(getBaseUrl());
  // URL editing is an advanced action — revealed on demand, or automatically
  // when the connection needs recovery (combined-audit Me direction).
  const [editUrl, setEditUrl] = useState(false);
  const showEditor = editUrl || !connected;

  return (
    <View style={{ flex: 1, backgroundColor: t.background, paddingTop: insets.top }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.lg, height: 60 }}>
        <Text style={{ ...type.title, color: t.onSurface, flex: 1 }}>Me</Text>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: space.xl }}>
        <SectionLabel>Daemon connection</SectionLabel>
        <Card style={{ marginHorizontal: space.lg }}>
          {/* connection health is the anchor: compact when healthy, expressive
              with recovery when not */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.md }}>
            <PresenceDot online={connected} size={9} />
            <View style={{ flex: 1 }}>
              <Text style={{ ...type.label, color: connected ? t.success : t.danger }}>
                {connected ? 'Connected' : 'Disconnected'}
              </Text>
              <Text style={{ ...type.micro, fontWeight: '400', color: t.onSurfaceVariant }} numberOfLines={1}>
                {getBaseUrl()}
              </Text>
            </View>
            {connected && (
              <Pressable
                onPress={() => setEditUrl((v) => !v)}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel="Edit daemon address"
                style={{ paddingHorizontal: space.sm, paddingVertical: 6 }}>
                <Text style={{ ...type.label, color: t.primary }}>{editUrl ? 'Done' : 'Edit'}</Text>
              </Pressable>
            )}
          </View>
          {!connected && error && (
            <Text style={{ ...type.micro, fontWeight: '400', color: t.danger, paddingHorizontal: space.md, paddingBottom: space.sm }} numberOfLines={3}>
              {error}
            </Text>
          )}
          {showEditor && (
            <View style={{ flexDirection: 'row', gap: space.sm, padding: space.md, borderTopWidth: 1, borderTopColor: t.outlineVariant }}>
              <TextInput
                value={urlDraft}
                onChangeText={setUrlDraft}
                autoCapitalize="none"
                autoCorrect={false}
                accessibilityLabel="Daemon address"
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
                accessibilityRole="button"
                style={{
                  paddingHorizontal: 14,
                  height: 42,
                  borderRadius: shape.sm,
                  backgroundColor: t.primary,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}>
                <Text style={{ ...type.label, color: t.onPrimary }}>{connected ? 'Apply' : 'Retry'}</Text>
              </Pressable>
            </View>
          )}
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
          <ThemeToggle />
          <Row label="Active theme" value={mode === 'dark' ? 'Dark' : 'Light'} />
          <Row label="Version" value={Constants.expoConfig?.version ?? '1.0.0'} />
        </Card>
      </ScrollView>
    </View>
  );
}
