import React, { useMemo } from 'react';
import { useRouter } from 'expo-router';
import { View, Text, Pressable } from '@/tw';
import { SigilChip } from '@/components/sigil';
import { View as RNView } from 'react-native';
import { ember, nameColor } from '@/theme/tokens';
import { useTheme } from '@/theme/use-theme';
import { useSync } from '@/lib/store';
import { clockTime, displayName, splitBody } from '@/lib/format';
import type { Peer, SyncEvent } from '@/lib/types';

const hexA = (hex: string, a: number) =>
  `${hex}${Math.round(a * 255)
    .toString(16)
    .padStart(2, '0')}`;

// Inline runs: @mentions (per-agent hue, reference paintMentions()),
// `code` chips, **bold** spans.
const INLINE = /(@[\w:./-]+|`[^`]+`|\*\*[^*]+\*\*)/g;

// Mention/inline formatting per design.md §6 + v2.html fmt(): mentions are
// bold in the mentioned agent's hue (@you in accent); inline code is mono
// on a fg-mix chip; self bubbles keep inherited color with underline.
export function BodyText({
  text,
  self,
  small,
  muted,
  numberOfLines,
}: {
  text: string;
  self?: boolean;
  small?: boolean;
  muted?: boolean;
  numberOfLines?: number;
}) {
  const { dark, c } = useTheme();
  const { state } = useSync();
  const idByName = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of state?.peers ?? []) if (p.session_name) m.set(p.session_name.toLowerCase(), p.peer_id);
    return m;
  }, [state]);

  const mentionColor = (tag: string) => {
    const n = tag.slice(1).toLowerCase();
    if (n === 'you') return dark ? ember.dark : ember.light;
    const id = idByName.get(n);
    return id ? nameColor(id, dark) : c.pri;
  };
  const codeBg = hexA(self ? c.onpric : c.fg, self ? 0.14 : 0.09);

  const spans = (t: string) =>
    t.split(INLINE).map((p, i) => {
      if (p.startsWith('@'))
        return (
          <Text
            key={i}
            className={`font-sans-bold ${self ? 'text-onpric underline' : ''}`}
            style={self ? undefined : { color: mentionColor(p) }}
          >
            {p}
          </Text>
        );
      if (p.length > 2 && p.startsWith('`') && p.endsWith('`'))
        // Inline View chip: a nested Text can't round its background, and
        // reference chips are 5px-rounded with real padding.
        return (
          <RNView
            key={i}
            style={{
              backgroundColor: codeBg,
              borderRadius: 5,
              paddingHorizontal: 5,
              paddingVertical: 1,
              transform: [{ translateY: 3 }],
            }}
          >
            <Text
              className={`font-mono ${small ? 'text-[11px]' : 'text-[12px]'} ${
                self ? 'text-onpric' : 'text-fg'
              }`}
            >
              {p.slice(1, -1)}
            </Text>
          </RNView>
        );
      if (p.length > 4 && p.startsWith('**') && p.endsWith('**'))
        return (
          <Text key={i} className="font-sans-bold">
            {p.slice(2, -2)}
          </Text>
        );
      return p;
    });

  const base = `font-sans ${small ? 'text-[12.5px] leading-[1.45]' : 'text-[14px] leading-[1.5]'} ${
    self ? 'text-onpric' : muted ? 'text-fg2' : 'text-fg'
  }`;

  // Clamped previews (activity rows) stay a single flat Text.
  if (numberOfLines != null) {
    return (
      <Text numberOfLines={numberOfLines} className={base}>
        {spans(text)}
      </Text>
    );
  }

  // Full messages get block layout: bold lead-in title above a numbered
  // list (rich-title + ol.plan) with hanging indent on list items.
  const lines = text.split('\n');
  return (
    <View>
      {lines.map((ln, i) => {
        const li = ln.match(/^(\d+)\.\s+(.*)$/);
        if (li)
          return (
            <View key={i} className="mt-[3px] flex-row items-baseline pl-1">
              <Text className={base}>{li[1]}. </Text>
              <Text className={`${base} min-w-0 flex-1`}>{spans(li[2]!)}</Text>
            </View>
          );
        if (ln.trim() === '') return <View key={i} className="h-1.5" />;
        const title = i === 0 && /^\d+\.\s/.test(lines[1] ?? '');
        return (
          <Text key={i} className={`${base} ${title ? 'mb-[5px] font-sans-bold' : ''}`}>
            {spans(ln)}
          </Text>
        );
      })}
    </View>
  );
}

// Tonal message bubble row (mobile.js .mmsg): asymmetric expressive radii —
// agents 5/18/18/18, self mirrored 18/5/18/18 on the accent container.
export function MessageRow({
  event,
  sender,
  self,
  small = false,
  roomId,
  showThreadChip = true,
  lastReplyAt,
}: {
  event: SyncEvent;
  sender?: Peer;
  self: boolean;
  small?: boolean;
  roomId?: string;
  showThreadChip?: boolean;
  lastReplyAt?: string;
}) {
  const router = useRouter();
  const { dark, c } = useTheme();
  const senderId = event.sender_peer_id;
  const name = self ? 'You' : displayName(sender?.session_name, senderId);
  const segments = splitBody(event.body);
  const av = small ? 28 : 34;

  return (
    <View className="flex-row gap-2.5 px-4 py-[7px]">
      <Pressable
        onPress={() => !self && sender && router.push(`/agent/${encodeURIComponent(senderId)}`)}
        disabled={self || !sender}
      >
        <SigilChip id={senderId} tool={sender?.tool} name={name} size={av} self={self} />
      </Pressable>
      <View className="min-w-0 flex-1">
        <View className="mb-[3px] flex-row items-baseline gap-[7px]">
          <Text
            className="font-sans-bold text-[12.5px]"
            style={{ color: self ? c.pri : nameColor(senderId, dark) }}
          >
            {name}
          </Text>
          <Text className="font-mono text-[9px] text-fg3">{clockTime(event.created_at)}</Text>
        </View>
        <View
          className={`max-w-full self-start px-3.5 py-2.5 ${
            self
              ? 'rounded-tl-[18px] rounded-tr-[5px] rounded-b-[18px] bg-pric'
              : 'rounded-tl-[5px] rounded-tr-[18px] rounded-b-[18px] bg-surf'
          }`}
        >
          {segments.map((s, i) =>
            s.kind === 'code' ? (
              <View key={i} className="mb-0.5 mt-2 rounded-xl bg-bg/60 px-3 py-2.5">
                <Text className="font-mono text-[11px] leading-[1.55] text-fg">{s.content}</Text>
              </View>
            ) : (
              <BodyText key={i} text={s.content} self={self} small={small} />
            ),
          )}
          {showThreadChip && (event.reply_count ?? 0) > 0 && roomId ? (
            <Pressable
              onPress={() =>
                router.push(`/thread/${event.event_id}?room=${encodeURIComponent(roomId)}`)
              }
              className="mt-[9px] self-start rounded-full bg-pric px-3.5 py-1.5"
            >
              <Text className="font-sans-bold text-[12px] text-pri">
                ↳ {event.reply_count} {event.reply_count === 1 ? 'reply' : 'replies'}
                {lastReplyAt ? ` · last ${clockTime(lastReplyAt)}` : ''}
              </Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </View>
  );
}
