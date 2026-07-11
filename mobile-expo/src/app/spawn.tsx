import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { useTheme } from '../theme/useTheme';
import { shape, space, type } from '../theme/tokens';
import { useSync } from '../lib/store';
import { api } from '../lib/api';
import { FilterChip, IdentityChip, SectionLabel } from '../components/ui';

export default function SpawnScreen() {
  const { t } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { state, refresh } = useSync();

  const tools = useMemo(
    () => Object.values(state?.launch_tools ?? {}).filter((x) => x.available),
    [state],
  );
  const [tool, setTool] = useState<string | null>(null);
  const activeTool = tool ?? tools[0]?.tool ?? null;
  const profiles = (state?.launch_profiles ?? []).filter((p) => p.available && p.tool === activeTool);
  const [profile, setProfile] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [repo, setRepo] = useState('');
  const [group, setGroup] = useState<string | null>(null);
  const [model, setModel] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const repoSuggestions = useMemo(
    () => [...new Set((state?.group_paths ?? []).filter((p) => p.active).map((p) => p.path))].slice(0, 4),
    [state],
  );

  const launch = async () => {
    if (!activeTool || busy) return;
    setBusy(true);
    setResult(null);
    try {
      const res = await api.spawn({
        tool: activeTool,
        ...(profile ? { profile_name: profile } : {}),
        ...(name.trim() ? { name: name.trim() } : {}),
        ...(repo.trim() ? { repo: repo.trim() } : {}),
        ...(group ? { group } : {}),
        ...(model.trim() ? { model: model.trim() } : {}),
      });
      await refresh();
      setResult(`Launched ${res.sessionName ?? res.peerId}`);
      setTimeout(() => router.back(), 900);
    } catch (e) {
      setResult(String(e).slice(0, 250));
    } finally {
      setBusy(false);
    }
  };

  const inputStyle = {
    ...type.body,
    color: t.onSurface,
    backgroundColor: t.surfaceContainer,
    borderRadius: shape.sm,
    paddingHorizontal: space.md,
    height: 46,
    marginHorizontal: space.lg,
  } as const;

  return (
    <View style={{ flex: 1, backgroundColor: t.background, paddingTop: insets.top }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', height: 56, paddingHorizontal: space.sm }}>
        <Pressable onPress={() => router.back()} hitSlop={8} style={{ padding: space.sm }}>
          <MaterialIcons name="close" size={22} color={t.onSurface} />
        </Pressable>
        <Text style={{ ...type.section, color: t.onSurface, flex: 1 }}>Spawn agent</Text>
        <Pressable
          onPress={launch}
          disabled={busy || !activeTool}
          style={{
            paddingHorizontal: 18,
            height: 38,
            borderRadius: shape.full,
            backgroundColor: t.primary,
            alignItems: 'center',
            justifyContent: 'center',
            opacity: busy ? 0.6 : 1,
          }}>
          <Text style={{ ...type.label, color: t.onPrimary }}>{busy ? 'Launching…' : 'Launch'}</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: space.xl * 2 }}>
        <SectionLabel>Tool</SectionLabel>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, paddingHorizontal: space.lg }}>
          {tools.map((x) => (
            <IdentityChip key={x.tool} label={x.tool} active={activeTool === x.tool} onPress={() => { setTool(x.tool); setProfile(null); }} />
          ))}
          {tools.length === 0 && <Text style={{ ...type.label, fontWeight: '400', color: t.onSurfaceVariant }}>No launch tools available</Text>}
        </View>

        {profiles.length > 0 && (
          <>
            <SectionLabel>Profile</SectionLabel>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, paddingHorizontal: space.lg }}>
              {profiles.map((p) => (
                <FilterChip
                  key={p.name}
                  label={p.name}
                  active={profile === p.name}
                  onPress={() => setProfile(profile === p.name ? null : p.name)}
                />
              ))}
            </View>
          </>
        )}

        <SectionLabel>Name</SectionLabel>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="e.g. api-refactor"
          placeholderTextColor={t.onSurfaceVariant}
          autoCapitalize="none"
          style={inputStyle}
        />

        <SectionLabel>Repository</SectionLabel>
        <TextInput
          value={repo}
          onChangeText={setRepo}
          placeholder="/path/to/repo"
          placeholderTextColor={t.onSurfaceVariant}
          autoCapitalize="none"
          style={{ ...inputStyle, fontFamily: 'monospace', fontSize: 13 }}
        />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, paddingHorizontal: space.lg, paddingTop: space.sm }}>
          {repoSuggestions.map((p) => (
            <Pressable
              key={p}
              onPress={() => setRepo(p)}
              style={{ backgroundColor: t.surfaceContainer, borderRadius: shape.full, paddingHorizontal: 12, paddingVertical: 6 }}>
              <Text style={{ ...type.micro, color: t.onSurfaceVariant, fontFamily: 'monospace' }} numberOfLines={1}>
                {p.length > 38 ? '…' + p.slice(-37) : p}
              </Text>
            </Pressable>
          ))}
        </View>

        <SectionLabel>Join room</SectionLabel>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, paddingHorizontal: space.lg }}>
          {(state?.groups ?? []).map((g) => (
            <IdentityChip
              key={g.group_id}
              label={`#${g.name}`}
              colorKey={g.name}
              active={group === g.name}
              onPress={() => setGroup(group === g.name ? null : g.name)}
            />
          ))}
        </View>

        <SectionLabel>Model (optional)</SectionLabel>
        <TextInput
          value={model}
          onChangeText={setModel}
          placeholder="tool default"
          placeholderTextColor={t.onSurfaceVariant}
          autoCapitalize="none"
          style={inputStyle}
        />

        {result && (
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 8,
              marginHorizontal: space.lg,
              marginTop: space.xl,
              padding: space.md,
              borderRadius: shape.sm,
              backgroundColor: result.startsWith('Launched') ? t.successContainer : t.dangerContainer,
            }}>
            <MaterialIcons
              name={result.startsWith('Launched') ? 'rocket-launch' : 'error-outline'}
              size={16}
              color={result.startsWith('Launched') ? t.onSuccessContainer : t.onDangerContainer}
            />
            <Text
              style={{
                ...type.label,
                flex: 1,
                color: result.startsWith('Launched') ? t.onSuccessContainer : t.onDangerContainer,
              }}>
              {result}
            </Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}
