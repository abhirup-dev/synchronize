import React, { useMemo, useState } from 'react';
import { useRouter } from 'expo-router';
import { View, Text, Pressable, ScrollView, TextInput } from '@/tw';
import { MButton, toast, Section, Chip } from '@/components/ui';
import { useSync } from '@/lib/store';
import { api } from '@/lib/api';
import { useTheme } from '@/theme/use-theme';

// Spawn agent sheet (design.md §5.4): harness segments, optional launch
// profile, session name, target room — wired to /agent-sessions/launch.
export default function SpawnSheet() {
  const router = useRouter();
  const { c } = useTheme();
  const { state, refresh } = useSync();
  const tools = Object.values(state?.launch_tools ?? {}).filter((t) => t.available);
  const [tool, setTool] = useState<string | null>(tools[0]?.tool ?? null);
  const [profile, setProfile] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [group, setGroup] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const profiles = useMemo(
    () => (state?.launch_profiles ?? []).filter((p) => p.available && (!tool || p.tool === tool)),
    [state, tool],
  );
  const groups = state?.groups ?? [];
  const selTool = tool ?? tools[0]?.tool;

  const spawn = async () => {
    if (!selTool || busy) return;
    setBusy(true);
    try {
      const res = await api.spawn({
        tool: selTool,
        ...(profile ? { profile_name: profile } : {}),
        ...(name.trim() ? { name: name.trim() } : {}),
        ...(group ? { group } : {}),
      });
      await refresh();
      toast(`Spawning ${res.sessionName} — joins ${group ?? 'the bus'} on first heartbeat`);
      router.back();
    } catch (e) {
      toast(`Spawn failed: ${String(e).slice(0, 90)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView className="flex-1 bg-bg" contentContainerClassName="px-5 pb-7">
      <View className="flex-row items-baseline gap-2 pb-1 pt-4">
        <Text className="font-sans-bold text-[18px] text-fg">Spawn agent</Text>
        <Text className="font-mono text-[9.5px] uppercase text-fg3">NEW SESSION</Text>
      </View>

      <Section label="Harness" />
      <View className="flex-row flex-wrap gap-1.5">
        {tools.length ? (
          tools.map((t) => (
            <Chip
              key={t.tool}
              label={t.tool}
              on={selTool === t.tool}
              onPress={() => {
                setTool(t.tool);
                setProfile(null);
              }}
            />
          ))
        ) : (
          <Text className="font-mono text-[10px] text-fg3">NO LAUNCH TOOLS AVAILABLE</Text>
        )}
      </View>

      {profiles.length ? (
        <>
          <Section label="Profile" />
          <View className="flex-row flex-wrap gap-1.5">
            {profiles.map((p) => (
              <Chip
                key={p.name}
                label={p.name}
                on={profile === p.name}
                onPress={() => setProfile(profile === p.name ? null : p.name)}
              />
            ))}
          </View>
        </>
      ) : null}

      <Section label="Session name (optional)" />
      <TextInput
        className="rounded-full bg-surf px-[18px] py-3 font-sans text-[14px] text-fg"
        placeholder="e.g. checkout-fixer"
        placeholderTextColor={c.fg3}
        value={name}
        onChangeText={setName}
        autoCapitalize="none"
      />

      {groups.length ? (
        <>
          <Section label="Join room" />
          <View className="flex-row flex-wrap gap-1.5">
            {groups.map((g) => (
              <Chip
                key={g.group_id}
                label={`#${g.name}`}
                on={group === g.name}
                onPress={() => setGroup(group === g.name ? null : g.name)}
              />
            ))}
          </View>
        </>
      ) : null}

      <View className="mt-6 flex-row">
        <MButton
          label={busy ? 'Spawning…' : 'Spawn agent'}
          variant="primary"
          disabled={busy || !selTool}
          onPress={spawn}
        />
      </View>
    </ScrollView>
  );
}
