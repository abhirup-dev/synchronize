import React from 'react';
import { Pressable, Text, View, type ViewStyle } from 'react-native';
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
      style={{
        width: size,
        height: size,
        borderRadius: size,
        backgroundColor: online ? t.success : t.outline,
      }}
    />
  );
}

// Small uppercase badge — used for the APP marker on agent authors.
export function Badge({ label }: { label: string }) {
  const { t } = useTheme();
  return (
    <View
      style={{
        backgroundColor: t.surfaceContainerHigh,
        borderRadius: shape.xs,
        paddingHorizontal: 6,
        paddingVertical: 1.5,
      }}>
      <Text style={{ ...type.micro, color: t.onSurfaceVariant, letterSpacing: 0.5 }}>{label.toUpperCase()}</Text>
    </View>
  );
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
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingHorizontal: 14,
        height: 36,
        borderRadius: shape.full,
        borderWidth: 1,
        borderColor: active ? t.primary : t.outlineVariant,
        backgroundColor: active ? t.primaryContainer : 'transparent',
      }}>
      <Text style={{ ...type.label, color: active ? t.onPrimaryContainer : t.onSurface }}>{label}</Text>
      {count !== undefined && (
        <Text style={{ ...type.label, color: emphasis ? t.awaiting : active ? t.onPrimaryContainer : t.onSurfaceVariant }}>
          {count}
        </Text>
      )}
    </Pressable>
  );
}

export function AckButton({ acked, onPress, compact }: { acked?: boolean; onPress: () => void; compact?: boolean }) {
  const { t } = useTheme();
  if (acked) {
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: compact ? 10 : 14, height: 32 }}>
        <MaterialIcons name="check" size={14} color={t.success} />
        <Text style={{ ...type.label, color: t.success }}>Acked</Text>
      </View>
    );
  }
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      style={{
        paddingHorizontal: compact ? 12 : 16,
        height: 32,
        borderRadius: shape.full,
        borderWidth: 1,
        borderColor: t.outline,
        alignItems: 'center',
        justifyContent: 'center',
      }}>
      <Text style={{ ...type.label, color: t.primary }}>Ack</Text>
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
