import React from 'react';
import { useRouter } from 'expo-router';
import { View, Text, Pressable } from '@/tw';
import { SigilChip } from '@/components/sigil';
import { nameColor } from '@/theme/tokens';
import { useTheme } from '@/theme/use-theme';
import { clockTime, displayName, splitBody } from '@/lib/format';
import type { Peer, SyncEvent } from '@/lib/types';

// Inline mention highlighting — @name in primary, bold (design.md §6).
export function BodyText({ text, self, small }: { text: string; self?: boolean; small?: boolean }) {
  const parts = text.split(/(@[\w:./-]+)/g);
  return (
    <Text className={`font-sans ${small ? 'text-[12.5px]' : 'text-[14px]'} leading-[1.5] ${self ? 'text-onpric' : 'text-fg'}`}>
      {parts.map((p, i) =>
        p.startsWith('@') ? (
          <Text key={i} className={`font-sans-bold ${self ? 'text-onpric underline' : 'text-pri'}`}>
            {p}
          </Text>
        ) : (
          p
        ),
      )}
    </Text>
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
}: {
  event: SyncEvent;
  sender?: Peer;
  self: boolean;
  small?: boolean;
  roomId?: string;
  showThreadChip?: boolean;
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
              <View key={i} className="my-1 rounded-xl bg-bg/60 px-3 py-2.5">
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
              className="mt-2 self-start rounded-full bg-pric px-3.5 py-1.5"
            >
              <Text className="font-sans-bold text-[12px] text-onpric">
                ↳ {event.reply_count} {event.reply_count === 1 ? 'reply' : 'replies'}
              </Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </View>
  );
}
