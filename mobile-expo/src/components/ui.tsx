import React from 'react';
import { ActivityIndicator, Pressable, Text, View, type ViewStyle } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useTheme } from '../theme/useTheme';
import { shape, space, type } from '../theme/tokens';
import { initials } from '../lib/format';

export function Avatar({ name, size = 36, radius }: { name: string; size?: number; radius?: number }) {
  const { identity } = useTheme();
  const c = identity(name);
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: radius ?? Math.round(size * 0.3),
        backgroundColor: c.bg,
        alignItems: 'center',
        justifyContent: 'center',
      }}>
      <Text style={{ color: c.fg, fontSize: size * 0.4, fontWeight: '700' }}>{initials(name)}</Text>
    </View>
  );
}

export function PresenceDot({ online, size = 8 }: { online?: boolean; size?: number }) {
  const { t } = useTheme();
  return (
    <View
      accessibilityLabel={online ? 'online' : 'offline'}
      style={{
        width: size,
        height: size,
        borderRadius: size,
        backgroundColor: online ? t.success : t.outline,
      }}
    />
  );
}

// Small uppercase badge — the APP/tool marker on agent authors. Neutral grey
// per feedback-1 (color budget lives in avatars + semantic status, not tags).
export function Badge({ label, bg, fg }: { label: string; bg?: string; fg?: string }) {
  const { t } = useTheme();
  return (
    <View
      style={{
        backgroundColor: bg ?? t.surfaceContainerHigh,
        borderRadius: shape.xs,
        paddingHorizontal: 6,
        paddingVertical: 1.5,
      }}>
      <Text style={{ ...type.micro, color: fg ?? t.onSurfaceVariant, letterSpacing: 0.5 }}>{label.toUpperCase()}</Text>
    </View>
  );
}

// Inset hairline divider — the M3 list separator (starts at the text edge).
export function Divider({ inset = 0 }: { inset?: number }) {
  const { t } = useTheme();
  return <View style={{ height: 1, marginLeft: inset, backgroundColor: t.outlineVariant }} />;
}

export function FilterChip({
  label,
  count,
  active,
  emphasis,
  onPress,
}: {
  label: string;
  count?: number;
  active?: boolean;
  emphasis?: boolean;
  onPress?: () => void;
}) {
  const { t } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      hitSlop={{ top: 8, bottom: 8 }}
      accessibilityRole="button"
      accessibilityState={{ selected: !!active }}
      accessibilityLabel={count !== undefined ? `${label}, ${count}` : label}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingHorizontal: 14,
        height: 32,
        borderRadius: shape.sm,
        borderWidth: active ? 0 : 1,
        borderColor: t.outlineVariant,
        backgroundColor: active ? t.primaryContainer : 'transparent',
      }}>
      <Text style={{ ...type.label, color: active ? t.onPrimaryContainer : t.onSurfaceVariant }}>{label}</Text>
      {count !== undefined && (
        <Text style={{ ...type.label, color: active ? t.onPrimaryContainer : emphasis && count > 0 ? t.awaiting : t.onSurfaceVariant }}>
          {count}
        </Text>
      )}
    </Pressable>
  );
}

// Ack = compact tick with a truthful state machine (combined-audit "signature
// pattern"): idle grey outline → pending → confirmed green → error/retry.
export type AckState = 'idle' | 'pending' | 'done' | 'error';

export function AckButton({
  state = 'idle',
  onPress,
  compact,
}: {
  state?: AckState;
  onPress: () => void;
  compact?: boolean;
}) {
  const { t } = useTheme();
  const size = compact ? 28 : 32;
  const done = state === 'done';
  const error = state === 'error';
  return (
    <Pressable
      onPress={done || state === 'pending' ? undefined : onPress}
      hitSlop={(48 - size) / 2} // 48dp interaction envelope around the compact glyph
      accessibilityRole="button"
      accessibilityLabel={done ? 'acknowledged' : error ? 'acknowledge failed, retry' : 'acknowledge'}
      accessibilityState={{ disabled: state === 'pending', checked: done }}
      style={{
        width: size,
        height: size,
        borderRadius: shape.full,
        borderWidth: done ? 0 : 1,
        borderColor: error ? t.danger : t.outline,
        backgroundColor: done ? t.successContainer : 'transparent',
        opacity: state === 'pending' ? 0.55 : 1,
        alignItems: 'center',
        justifyContent: 'center',
      }}>
      {state === 'pending' ? (
        <ActivityIndicator size={compact ? 12 : 14} color={t.onSurfaceVariant} />
      ) : (
        <MaterialIcons
          name={error ? 'refresh' : 'check'}
          size={compact ? 15 : 16}
          color={done ? t.success : error ? t.danger : t.onSurfaceVariant}
        />
      )}
    </Pressable>
  );
}

// Semantic state chip — maps free-form activity/lifecycle strings to a toned
// dot+label pill (working→green, awaiting→amber, failed→red, spawning→blue).
const STATUS_TONES: [RegExp, 'success' | 'awaiting' | 'danger' | 'primary'][] = [
  [/fail|error|dead|crash/i, 'danger'],
  [/await|block|wait|need|paus|input/i, 'awaiting'],
  [/work|run|active|stream|think|online/i, 'success'],
  [/spawn|launch|start|ready/i, 'primary'],
];

// Quiet by default (Paseo-style dot + plain label); only the emphasized states
// (needs input / failed) earn a tonal pill so one glance finds what needs you.
export function StatusChip({ state }: { state?: string | null }) {
  const { t } = useTheme();
  if (!state) return null;
  const tone = STATUS_TONES.find(([re]) => re.test(state))?.[1];
  const emphasized = tone === 'awaiting' || tone === 'danger';
  const dot =
    tone === 'success' ? t.success
    : tone === 'awaiting' ? t.awaiting
    : tone === 'danger' ? t.danger
    : tone === 'primary' ? t.primary
    : t.outline;
  const fg = emphasized
    ? (tone === 'danger' ? t.onDangerContainer : t.onAwaitingContainer)
    : t.onSurfaceVariant;
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
        backgroundColor: emphasized ? (tone === 'danger' ? t.dangerContainer : t.awaitingContainer) : 'transparent',
        borderRadius: shape.full,
        paddingHorizontal: emphasized ? 9 : 0,
        paddingVertical: emphasized ? 3 : 0,
        alignSelf: 'flex-start',
      }}>
      <View style={{ width: 6, height: 6, borderRadius: 6, backgroundColor: dot }} />
      <Text style={{ ...type.micro, color: fg }} numberOfLines={1}>{state}</Text>
    </View>
  );
}

// Identity-colored selectable chip — used for tool/room pickers so each option
// carries the same hue it has everywhere else (avatars, badges).
export function IdentityChip({
  label,
  colorKey,
  active,
  onPress,
}: {
  label: string;
  colorKey?: string;
  active?: boolean;
  onPress?: () => void;
}) {
  const { identity } = useTheme();
  const c = identity(colorKey ?? label);
  return (
    <Pressable
      onPress={onPress}
      style={{
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 14,
        height: 36,
        borderRadius: shape.full,
        backgroundColor: active ? c.bg : c.tint,
      }}>
      <Text style={{ ...type.label, color: active ? c.fg : c.onTint }}>{label}</Text>
    </Pressable>
  );
}

export function EmptyState({ icon, title, body }: { icon: keyof typeof MaterialIcons.glyphMap; title: string; body?: string }) {
  const { t } = useTheme();
  return (
    <View style={{ alignItems: 'center', paddingVertical: 64, paddingHorizontal: space.xl, gap: space.sm }}>
      <MaterialIcons name={icon} size={40} color={t.outline} />
      <Text style={{ ...type.section, color: t.onSurfaceVariant }}>{title}</Text>
      {body ? <Text style={{ ...type.body, color: t.onSurfaceVariant, textAlign: 'center' }}>{body}</Text> : null}
    </View>
  );
}

export function Card({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  const { t } = useTheme();
  return (
    <View style={[{ backgroundColor: t.surfaceContainer, borderRadius: shape.md, overflow: 'hidden' }, style]}>
      {children}
    </View>
  );
}

export function SectionLabel({ children }: { children: string }) {
  const { t } = useTheme();
  return (
    <Text
      style={{
        ...type.micro,
        color: t.onSurfaceVariant,
        letterSpacing: 1,
        textTransform: 'uppercase',
        paddingHorizontal: space.lg,
        paddingTop: space.xl,
        paddingBottom: space.sm,
      }}>
      {children}
    </Text>
  );
}
