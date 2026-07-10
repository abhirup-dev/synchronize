import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { useTheme } from '../../../theme/useTheme';
import { shape, space, type } from '../../../theme/tokens';
import { api } from '../../../lib/api';
import { useSync } from '../../../lib/store';
import { timeAgo } from '../../../lib/format';
import { Avatar, Badge, EmptyState } from '../../../components/ui';

interface ArchivedSession {
  peer_id: string;
  session_name?: string;
  tool?: string;
  archived_at?: string;
  archived_reason?: string | null;
}

export default function ArchiveScreen() {
  const { t } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { refresh } = useSync();
  const [sessions, setSessions] = useState<ArchivedSession[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = (await api.archivedSessions()) as Record<string, unknown>;
      const list = (res.sessions ?? res.peers ?? (Array.isArray(res) ? res : [])) as ArchivedSession[];
      setSessions(list);
      setError(null);
    } catch (e) {
      setError(String(e).slice(0, 200));
      setSessions([]);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const resume = async (peerId: string) => {
    setBusy(peerId);
    try {
      await api.resumeSession(peerId);
      await Promise.all([load(), refresh()]);
    } catch (e) {
      setError(String(e).slice(0, 200));
    } finally {
      setBusy(null);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: t.background, paddingTop: insets.top }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', height: 56, paddingHorizontal: space.sm }}>
        <Pressable onPress={() => router.back()} hitSlop={8} style={{ padding: space.sm }}>
          <MaterialIcons name="arrow-back" size={22} color={t.onSurface} />
        </Pressable>
        <Text style={{ ...type.section, color: t.onSurface }}>Archive</Text>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: space.xl }}>
        {error && (
          <Text style={{ ...type.label, color: t.danger, paddingHorizontal: space.lg, paddingBottom: space.sm }}>{error}</Text>
        )}
        {sessions !== null && sessions.length === 0 && !error && (
          <EmptyState icon="inventory-2" title="No archived sessions" body="Archived agents can be resumed from here with their full context." />
        )}
        {(sessions ?? []).map((s) => {
          const name = s.session_name || s.peer_id;
          return (
            <View
              key={s.peer_id}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: space.md,
                paddingHorizontal: space.lg,
                paddingVertical: 11,
              }}>
              <Avatar name={name} size={42} />
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Text style={{ ...type.label, fontSize: 15, fontWeight: '600', color: t.onSurface }} numberOfLines={1}>
                    {name}
                  </Text>
                  {s.tool && <Badge label={s.tool} />}
                </View>
                <Text style={{ ...type.label, fontWeight: '400', color: t.onSurfaceVariant, marginTop: 2 }} numberOfLines={1}>
                  {s.archived_at ? `archived ${timeAgo(s.archived_at)} ago` : 'archived'}
                  {s.archived_reason ? ` · ${s.archived_reason}` : ''}
                </Text>
              </View>
              <Pressable
                onPress={() => resume(s.peer_id)}
                disabled={busy !== null}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 4,
                  paddingHorizontal: 14,
                  height: 36,
                  borderRadius: shape.full,
                  backgroundColor: t.primaryContainer,
                  opacity: busy && busy !== s.peer_id ? 0.5 : 1,
                }}>
                <MaterialIcons name="play-arrow" size={16} color={t.onPrimaryContainer} />
                <Text style={{ ...type.label, color: t.onPrimaryContainer }}>{busy === s.peer_id ? '…' : 'Resume'}</Text>
              </Pressable>
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}
