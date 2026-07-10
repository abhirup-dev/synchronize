import React, { useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { useTheme } from '../../../../theme/useTheme';
import { shape, space, type } from '../../../../theme/tokens';
import { useSync } from '../../../../lib/store';
import { api } from '../../../../lib/api';
import { timeAgo } from '../../../../lib/format';
import { Avatar, Badge, Card, PresenceDot, SectionLabel } from '../../../../components/ui';

function DetailRow({ label, value, mono }: { label: string; value?: string | null; mono?: boolean }) {
  const { t } = useTheme();
  if (!value) return null;
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
      <Text
        style={{ ...(mono ? type.mono : type.label), color: t.onSurface, flexShrink: 1, textAlign: 'right' }}
        numberOfLines={2}>
        {value}
      </Text>
    </View>
  );
}

export default function AgentProfileScreen() {
  const { t } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string }>();
  const peerId = decodeURIComponent(params.id ?? '');
  const { agents, refresh } = useSync();
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [modelDraft, setModelDraft] = useState('');

  const agent = agents.find((a) => a.peer.peer_id === peerId);
  if (!agent) {
    return (
      <View style={{ flex: 1, backgroundColor: t.background, paddingTop: insets.top, padding: space.lg }}>
        <Text style={{ ...type.body, color: t.onSurfaceVariant }}>Agent not found (it may have been archived).</Text>
      </View>
    );
  }
  const { peer, runtime, lifecycle } = agent;
  const name = peer.session_name || peer.peer_id;
  const archived = !!peer.archived_at;

  const run = async (key: string, fn: () => Promise<unknown>, done: string) => {
    setBusy(key);
    setNote(null);
    try {
      await fn();
      await refresh();
      setNote(done);
    } catch (e) {
      setNote(String(e).slice(0, 200));
    } finally {
      setBusy(null);
    }
  };

  const ActionButton = ({
    label,
    icon,
    onPress,
    tone = 'neutral',
    id,
  }: {
    label: string;
    icon: keyof typeof MaterialIcons.glyphMap;
    onPress: () => void;
    tone?: 'neutral' | 'primary' | 'danger';
    id: string;
  }) => (
    <Pressable
      onPress={onPress}
      disabled={busy !== null}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingHorizontal: 16,
        height: 40,
        borderRadius: shape.full,
        backgroundColor: tone === 'primary' ? t.primaryContainer : t.surfaceContainer,
        opacity: busy && busy !== id ? 0.5 : 1,
      }}>
      <MaterialIcons
        name={icon}
        size={16}
        color={tone === 'danger' ? t.danger : tone === 'primary' ? t.onPrimaryContainer : t.onSurface}
      />
      <Text
        style={{
          ...type.label,
          color: tone === 'danger' ? t.danger : tone === 'primary' ? t.onPrimaryContainer : t.onSurface,
        }}>
        {busy === id ? '…' : label}
      </Text>
    </Pressable>
  );

  return (
    <View style={{ flex: 1, backgroundColor: t.background, paddingTop: insets.top }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', height: 56, paddingHorizontal: space.sm }}>
        <Pressable onPress={() => router.back()} hitSlop={8} style={{ padding: space.sm }}>
          <MaterialIcons name="arrow-back" size={22} color={t.onSurface} />
        </Pressable>
        <Text style={{ ...type.section, color: t.onSurface }}>Agent</Text>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: space.xl }}>
        <View style={{ alignItems: 'center', gap: space.sm, paddingVertical: space.lg }}>
          <Avatar name={name} size={72} />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text style={{ ...type.title, color: t.onSurface }}>{name}</Text>
            <Badge label={peer.tool} />
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <PresenceDot online={peer.online} />
            <Text style={{ ...type.label, fontWeight: '400', color: t.onSurfaceVariant }}>
              {archived ? `archived ${timeAgo(peer.archived_at)} ago` : peer.online ? 'online' : 'offline'}
              {peer.activity_state ? ` · ${peer.activity_state}` : ''}
            </Text>
          </View>
        </View>

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, justifyContent: 'center', paddingHorizontal: space.lg }}>
          <ActionButton
            id="msg"
            label="Message"
            icon="chat-bubble-outline"
            tone="primary"
            onPress={() => router.push(`/room/${encodeURIComponent(`dm:${peer.peer_id}`)}`)}
          />
          {!archived ? (
            <ActionButton
              id="archive"
              label="Archive"
              icon="inventory-2"
              tone="danger"
              onPress={() => run('archive', () => api.archiveSession(peer.peer_id, 'archived from mobile'), 'Session archived')}
            />
          ) : (
            <ActionButton
              id="resume"
              label="Resume"
              icon="play-arrow"
              tone="primary"
              onPress={() => run('resume', () => api.resumeSession(peer.peer_id), 'Resume requested')}
            />
          )}
        </View>

        {note && (
          <Text style={{ ...type.label, color: t.primary, textAlign: 'center', marginTop: space.md, paddingHorizontal: space.lg }}>
            {note}
          </Text>
        )}

        <SectionLabel>Runtime</SectionLabel>
        <Card style={{ marginHorizontal: space.lg }}>
          <DetailRow label="Model" value={runtime?.model} />
          <DetailRow label="Thinking" value={runtime?.thinking} />
          <DetailRow label="Working dir" value={runtime?.cwd} mono />
          <DetailRow label="Branch" value={runtime?.git_branch ? `${runtime.git_branch}${runtime.git_dirty ? ' *' : ''}` : null} mono />
          <DetailRow label="PID" value={runtime?.pid ? String(runtime.pid) : null} mono />
          <DetailRow label="Host" value={runtime?.host_tool} />
          <DetailRow label="Lifecycle" value={lifecycle?.state ?? peer.lifecycle_state} />
          <DetailRow label="Last seen" value={runtime?.last_seen_at ? `${timeAgo(runtime.last_seen_at)} ago` : null} />
          <DetailRow label="Peer id" value={peer.peer_id} mono />
        </Card>

        <SectionLabel>Rooms</SectionLabel>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, paddingHorizontal: space.lg }}>
          {agent.rooms.length === 0 && <Text style={{ ...type.label, fontWeight: '400', color: t.onSurfaceVariant }}>None</Text>}
          {agent.rooms.map((r) => (
            <View key={r} style={{ backgroundColor: t.surfaceContainer, borderRadius: shape.full, paddingHorizontal: 12, paddingVertical: 6 }}>
              <Text style={{ ...type.label, color: t.onSurface }}>#{r}</Text>
            </View>
          ))}
        </View>

        {!archived && (
          <>
            <SectionLabel>Change model</SectionLabel>
            <View style={{ flexDirection: 'row', gap: space.sm, paddingHorizontal: space.lg }}>
              <TextInput
                value={modelDraft}
                onChangeText={setModelDraft}
                placeholder={runtime?.model ?? 'model id'}
                placeholderTextColor={t.onSurfaceVariant}
                autoCapitalize="none"
                style={{
                  flex: 1,
                  ...type.body,
                  color: t.onSurface,
                  backgroundColor: t.surfaceContainer,
                  borderRadius: shape.sm,
                  paddingHorizontal: space.md,
                  height: 44,
                }}
              />
              <Pressable
                onPress={() => modelDraft.trim() && run('model', () => api.setModel(peer.peer_id, modelDraft.trim()), 'Model updated')}
                style={{
                  paddingHorizontal: 16,
                  height: 44,
                  borderRadius: shape.sm,
                  backgroundColor: t.primary,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}>
                <Text style={{ ...type.label, color: t.onPrimary }}>{busy === 'model' ? '…' : 'Apply'}</Text>
              </Pressable>
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}
