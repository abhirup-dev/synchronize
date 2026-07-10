import React, { useState } from 'react';
import { Image, Pressable, Text, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useTheme } from '../theme/useTheme';
import { shape, space, type } from '../theme/tokens';
import { clockTime, displayName, splitBody } from '../lib/format';
import { mediaUrl } from '../lib/api';
import type { Peer, SyncEvent } from '../lib/types';
import { Avatar, Badge, PresenceDot } from './ui';

const QUICK_EMOJI = ['👍', '✅', '👀', '🎉', '❤️'];

const SYSTEM_LABEL: Record<string, { icon: keyof typeof MaterialIcons.glyphMap; text: string }> = {
  group_created: { icon: 'add-circle-outline', text: 'created the room' },
  group_joined: { icon: 'login', text: 'joined' },
  group_left: { icon: 'logout', text: 'left' },
  group_member_renamed: { icon: 'edit', text: 'was renamed' },
  group_member_alias_reclaimed: { icon: 'edit', text: 'reclaimed their alias' },
};

// Inline markdown-lite: **bold**, `code`, @mention. Keeps ordinary messages
// flat and readable (D-001) without a full markdown engine.
function InlineText({ text, color }: { text: string; color: string }) {
  const { t } = useTheme();
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`|@[\w:./-]+)/g);
  return (
    <Text style={{ ...type.body, color }}>
      {parts.map((p, i) => {
        if (p.startsWith('**') && p.endsWith('**'))
          return (
            <Text key={i} style={{ fontWeight: '700' }}>
              {p.slice(2, -2)}
            </Text>
          );
        if (p.startsWith('`') && p.endsWith('`') && p.length > 2)
          return (
            <Text key={i} style={{ ...type.mono, backgroundColor: t.codeBg }}>
              {p.slice(1, -1)}
            </Text>
          );
        if (p.startsWith('@') && p.length > 1)
          return (
            <Text key={i} style={{ color: t.primary, fontWeight: '600' }}>
              {p}
            </Text>
          );
        return p;
      })}
    </Text>
  );
}

// Non-message roster/system events render as one centered subtle row.
function SystemRow({ event, name }: { event: SyncEvent; name: string }) {
  const { t } = useTheme();
  const meta = SYSTEM_LABEL[event.type] ?? { icon: 'info-outline' as const, text: event.type.replace(/_/g, ' ') };
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        paddingHorizontal: space.lg,
        paddingVertical: 6,
      }}>
      <MaterialIcons name={meta.icon} size={13} color={t.onSurfaceVariant} />
      <Text style={{ ...type.micro, fontWeight: '400', color: t.onSurfaceVariant }}>
        {name} {meta.text} · {clockTime(event.created_at)}
      </Text>
    </View>
  );
}

export function MessageRow({
  event,
  peers,
  selfId,
  onOpenThread,
  onReact,
  isThreadRoot,
}: {
  event: SyncEvent;
  peers: Peer[];
  selfId: string;
  onOpenThread?: (event: SyncEvent) => void;
  onReact: (eventId: number, emoji: string) => void;
  isThreadRoot?: boolean;
}) {
  const { t } = useTheme();
  const [picker, setPicker] = useState(false);
  const [mediaFailed, setMediaFailed] = useState(false);
  const sender = peers.find((p) => p.peer_id === event.sender_peer_id);
  const name = displayName(sender?.session_name, event.sender_peer_id);

  const isMessage = event.type === 'group_message' || event.type === 'dm' || event.type.startsWith('media');
  if (!isMessage) return <SystemRow event={event} name={name} />;

  const isAgent = !!sender && sender.tool !== 'web';
  const segments = splitBody(event.body ?? '');
  const reactions = event.reactions ?? [];

  return (
    <View style={{ flexDirection: 'row', gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.sm }}>
      <Avatar name={name} />
      <View style={{ flex: 1, gap: 4 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text style={{ ...type.label, fontSize: 14, fontWeight: '700', color: t.onSurface }}>{name}</Text>
          {isAgent && <Badge label="app" />}
          {sender && <PresenceDot online={sender.online} size={6} />}
          <Text style={{ ...type.micro, color: t.onSurfaceVariant }}>{clockTime(event.created_at)}</Text>
        </View>

        {segments.map((seg, i) =>
          seg.kind === 'code' ? (
            <View
              key={i}
              style={{
                backgroundColor: t.codeBg,
                borderRadius: shape.sm,
                borderWidth: 1,
                borderColor: t.outlineVariant,
                padding: space.md,
              }}>
              {seg.lang ? <Text style={{ ...type.micro, color: t.onSurfaceVariant, marginBottom: 4 }}>{seg.lang}</Text> : null}
              <Text style={{ ...type.mono, color: t.onSurface }}>{seg.content}</Text>
            </View>
          ) : (
            <InlineText key={i} text={seg.content} color={t.onSurface} />
          ),
        )}

        {/* shared media — image straight from the daemon, chip fallback */}
        {event.media_id != null &&
          (mediaFailed ? (
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 6,
                alignSelf: 'flex-start',
                paddingHorizontal: 12,
                height: 34,
                borderRadius: shape.sm,
                backgroundColor: t.surfaceContainer,
                borderWidth: 1,
                borderColor: t.outlineVariant,
              }}>
              <MaterialIcons name="attach-file" size={15} color={t.onSurfaceVariant} />
              <Text style={{ ...type.label, color: t.onSurfaceVariant }}>Attachment #{event.media_id}</Text>
            </View>
          ) : (
            <Image
              source={{ uri: mediaUrl(event.media_id) }}
              onError={() => setMediaFailed(true)}
              style={{
                width: '100%',
                height: 220,
                borderRadius: shape.md,
                backgroundColor: t.surfaceContainer,
              }}
              resizeMode="cover"
            />
          ))}

        {/* reactions + ack count + quick add */}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
          {(event.acked_count ?? 0) > 0 && (
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 4,
                paddingHorizontal: 10,
                height: 28,
                borderRadius: shape.full,
                backgroundColor: t.successContainer,
              }}>
              <MaterialIcons name="check" size={13} color={t.onSuccessContainer} />
              <Text style={{ ...type.micro, color: t.onSuccessContainer }}>ACK {event.acked_count}</Text>
            </View>
          )}
          {reactions.map((r) => {
            const mine = r.by.some((b) => b.peer_id === selfId);
            return (
              <Pressable
                key={r.emoji}
                onPress={() => onReact(event.event_id, r.emoji)}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 4,
                  paddingHorizontal: 10,
                  height: 28,
                  borderRadius: shape.full,
                  backgroundColor: mine ? t.primaryContainer : t.surfaceContainer,
                  borderWidth: 1,
                  borderColor: mine ? t.primary : t.outlineVariant,
                }}>
                <Text style={{ fontSize: 13 }}>{r.emoji}</Text>
                <Text style={{ ...type.micro, color: mine ? t.onPrimaryContainer : t.onSurfaceVariant }}>{r.count}</Text>
              </Pressable>
            );
          })}
          <Pressable
            onPress={() => setPicker((v) => !v)}
            hitSlop={6}
            style={{
              width: 28,
              height: 28,
              borderRadius: shape.full,
              backgroundColor: t.surfaceContainer,
              alignItems: 'center',
              justifyContent: 'center',
            }}>
            <MaterialIcons name="add-reaction" size={15} color={t.onSurfaceVariant} />
          </Pressable>
          {picker &&
            QUICK_EMOJI.map((e) => (
              <Pressable
                key={e}
                onPress={() => {
                  setPicker(false);
                  onReact(event.event_id, e);
                }}
                style={{ paddingHorizontal: 4, height: 28, justifyContent: 'center' }}>
                <Text style={{ fontSize: 17 }}>{e}</Text>
              </Pressable>
            ))}
        </View>

        {/* inline thread summary — compact label + reply count (D-001) */}
        {!isThreadRoot && (event.reply_count ?? 0) > 0 && onOpenThread && (
          <Pressable
            onPress={() => onOpenThread(event)}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
              alignSelf: 'flex-start',
              paddingHorizontal: 12,
              height: 32,
              borderRadius: shape.full,
              backgroundColor: t.primaryContainer,
            }}>
            <MaterialIcons name="forum" size={14} color={t.onPrimaryContainer} />
            <Text style={{ ...type.label, color: t.onPrimaryContainer }}>Thread</Text>
            <Text style={{ ...type.label, color: t.onPrimaryContainer, opacity: 0.8 }}>
              {event.reply_count} {event.reply_count === 1 ? 'reply' : 'replies'}
            </Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}
