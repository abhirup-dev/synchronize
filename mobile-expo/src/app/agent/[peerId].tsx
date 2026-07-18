import React, { useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { View, Text, Pressable, ScrollView } from '@/tw';
import { MButton, StatusPill, statusOf, toast } from '@/components/ui';
import { SigilChip } from '@/components/sigil';
import { useSync } from '@/lib/store';
import { api } from '@/lib/api';
import { nameColor } from '@/theme/tokens';
import { useTheme } from '@/theme/use-theme';
import { displayName, timeAgo } from '@/lib/format';

// Model options per harness — set-model accepts free strings; these mirror
// the web UI's picker. ponytail: static list, wire to daemon metadata when it exists.
const MODEL_OPTIONS: Record<string, string[]> = {
  claude: ['opus-4.5', 'sonnet-4.5', 'haiku-4.5'],
  codex: ['gpt-5.2-codex', 'gpt-5.1-codex-mini'],
};

function KV({ k, v, mono = true }: { k: string; v?: string | null; mono?: boolean }) {
  if (!v) return null;
  return (
    <View className="flex-row justify-between gap-3 py-[5.5px]">
      <Text className="font-sans text-[13px] text-fg3">{k}</Text>
      <Text
        className={`min-w-0 flex-1 text-right ${mono ? 'font-mono text-[11.5px]' : 'font-sans-semibold text-[13px]'} text-fg`}
        numberOfLines={2}
      >
        {v}
      </Text>
    </View>
  );
}

function Section({ label }: { label: string }) {
  return (
    <Text className="mb-1.5 mt-4 font-mono text-[9px] uppercase tracking-[0.18em] text-fg3">
      {label}
    </Text>
  );
}

// Agent profile bottom sheet (design.md §6): identity header + status pill,
// mono KV rows, model switcher as choice chips, control pills.
export default function AgentProfileSheet() {
  const { peerId: raw } = useLocalSearchParams<{ peerId: string }>();
  const peerId = decodeURIComponent(raw ?? '');
  const router = useRouter();
  const { dark } = useTheme();
  const { agents, refresh } = useSync();
  const [busy, setBusy] = useState(false);

  const agent = agents.find((a) => a.peer.peer_id === peerId);
  if (!agent) {
    return (
      <View className="flex-1 items-center bg-bg pt-10">
        <Text className="font-mono text-[11px] text-fg3">AGENT NOT FOUND</Text>
      </View>
    );
  }
  const { peer, runtime } = agent;
  const status = statusOf(peer);
  const name = displayName(peer.session_name, peer.peer_id);
  const toolKey = Object.keys(MODEL_OPTIONS).find((k) => peer.tool?.includes(k));
  const models = toolKey ? MODEL_OPTIONS[toolKey] : runtime?.model ? [runtime.model] : [];

  const run = async (label: string, fn: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
      await refresh();
      toast(label);
    } catch (e) {
      toast(`Failed: ${String(e).slice(0, 80)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView className="flex-1 bg-bg" contentContainerClassName="pb-6">
      <View className="flex-row items-center gap-3 px-5 pb-2.5 pt-4">
        <SigilChip id={peer.peer_id} tool={peer.tool} name={name} size={44} />
        <View className="min-w-0 flex-1">
          <Text
            className="font-sans-bold text-[16px]"
            style={{ color: nameColor(peer.peer_id, dark) }}
            numberOfLines={1}
          >
            {name}
          </Text>
          <Text className="font-mono text-[9.5px] uppercase tracking-wide text-fg3" numberOfLines={1}>
            {[peer.tool, peer.purpose].filter(Boolean).join(' · ')}
          </Text>
        </View>
        <StatusPill status={status} />
      </View>

      <View className="px-5">
        <Section label="Runtime" />
        <KV k="Model" v={runtime?.model} />
        <KV k="Thinking" v={runtime?.thinking} mono={false} />
        <KV k="Last seen" v={peer.last_activity_at ? timeAgo(peer.last_activity_at) : undefined} />
        <Section label="Machine" />
        <KV k="Session" v={peer.session_name} />
        <KV k="Working dir" v={runtime?.cwd} />
        <KV
          k="Git"
          v={runtime?.git_branch ? `${runtime.git_branch} · ${runtime.git_dirty ? 'dirty' : 'clean'}` : undefined}
        />
        <KV k="PID" v={runtime?.pid ? String(runtime.pid) : undefined} />
        {peer.archived_at ? (
          <>
            <Section label="Archive" />
            <KV k="Archived" v={timeAgo(peer.archived_at)} />
            <KV k="Reason" v={peer.archived_reason} mono={false} />
          </>
        ) : null}

        {models.length > 1 ? (
          <>
            <Section label="Switch model" />
            <View className="flex-row flex-wrap gap-1.5">
              {models.map((m) => {
                const on = runtime?.model === m || runtime?.model?.includes(m);
                return (
                  <Pressable
                    key={m}
                    disabled={busy}
                    onPress={() =>
                      run(`${name} → ${m} · restarting session…`, () => api.setModel(peer.peer_id, m))
                    }
                    className={`rounded-full px-[13px] py-[7px] ${on ? 'bg-pric' : 'border border-outl'}`}
                  >
                    <Text className={`font-mono-bold text-[11px] ${on ? 'text-onpric' : 'text-fg2'}`}>
                      {m}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </>
        ) : null}

        <Section label="Controls" />
        <View className="flex-row flex-wrap gap-2">
          {status === 'archived' ? (
            <MButton
              label="Resume agent"
              variant="primary"
              disabled={busy}
              onPress={() =>
                run(`${name} resumed`, () => api.resumeSession(peer.peer_id))
              }
            />
          ) : (
            <MButton
              label="Archive"
              variant="danger"
              disabled={busy}
              onPress={() =>
                run(`${name} archived — transcript sealed`, () => api.archiveSession(peer.peer_id))
              }
            />
          )}
          <MButton
            label="Message"
            disabled={busy}
            onPress={() => {
              router.back();
              router.push(`/room/${encodeURIComponent(`dm:${peer.peer_id}`)}`);
            }}
          />
        </View>
      </View>
    </ScrollView>
  );
}
