import React from 'react';
import { Platform, ToastAndroid } from 'react-native';
import { View, Text, Pressable } from '@/tw';
import { statusColor, type AgentStatus } from '@/theme/tokens';
import { useTheme } from '@/theme/use-theme';
import type { Peer } from '@/lib/types';

// ponytail: ToastAndroid is the native M3 toast on the only shipping platform.
export function toast(msg: string) {
  if (Platform.OS === 'android') ToastAndroid.show(msg, ToastAndroid.SHORT);
  else console.log('[toast]', msg);
}

export function statusOf(p: Peer): AgentStatus {
  if (p.archived_at) return 'archived';
  if (!p.online) return 'idle';
  const s = `${p.activity_state ?? ''} ${p.presence ?? ''}`.toLowerCase();
  if (s.includes('await')) return 'awaiting';
  if (s.includes('idle')) return 'idle';
  return 'working';
}

export function StatusPill({ status }: { status: AgentStatus }) {
  const { c } = useTheme();
  return (
    <View className="ml-auto flex-row items-center gap-1.5 rounded-full bg-surf px-3 py-1">
      <View className="h-[7px] w-[7px] rounded-full" style={{ backgroundColor: statusColor(status, c) }} />
      <Text className="font-sans-bold text-[10px] uppercase tracking-wide text-fg2">{status}</Text>
    </View>
  );
}

// Top app bar — 21px 800 title over a mono sub-line (mobile.js .mtop).
export function MTop({
  title,
  sub,
  onBack,
  right,
}: {
  title: string;
  sub?: string;
  onBack?: () => void;
  right?: React.ReactNode;
}) {
  return (
    <View className="flex-row items-center gap-3 px-4 pb-2.5 pt-3.5">
      {onBack ? (
        <Pressable
          onPress={onBack}
          className="h-10 w-10 items-center justify-center rounded-full active:bg-surf"
          hitSlop={6}
        >
          <Text className="text-[17px] text-fg2">←</Text>
        </Pressable>
      ) : null}
      <View className="min-w-0 flex-1 pl-1.5">
        <Text className="font-sans-bold text-[21px] tracking-tight text-fg" numberOfLines={1}>
          {title}
        </Text>
        {sub ? (
          <Text className="mt-0.5 font-mono text-[9.5px] uppercase tracking-widest text-fg3" numberOfLines={1}>
            {sub}
          </Text>
        ) : null}
      </View>
      {right}
    </View>
  );
}

// M3 primary tabs — underline indicator on a hairline rule (mobile.js .mtabs).
export function MTabs({
  tabs,
  active,
  onChange,
}: {
  tabs: { key: string; label: string; count?: number }[];
  active: string;
  onChange: (key: string) => void;
}) {
  return (
    <View className="mt-0.5 flex-row border-b border-outl">
      {tabs.map((t) => {
        const on = t.key === active;
        return (
          <Pressable key={t.key} onPress={() => onChange(t.key)} className="flex-1 items-center pb-0 pt-2.5">
            <View className="flex-row items-baseline gap-1.5">
              <Text className={`font-sans-bold text-[13px] ${on ? 'text-pri' : 'text-fg2'}`}>{t.label}</Text>
              {t.count != null && t.count > 0 ? (
                <Text className={`font-mono text-[10px] ${on ? 'text-pri' : 'text-fg3'}`}>{t.count}</Text>
              ) : null}
            </View>
            <View
              className={`mt-2.5 h-[3px] w-[52%] rounded-t-[3px] ${on ? 'bg-pri' : 'bg-transparent'}`}
            />
          </Pressable>
        );
      })}
    </View>
  );
}

// Pill button (mobile.js .mbtn): tonal by default, filled when primary.
export function MButton({
  label,
  onPress,
  variant = 'tonal',
  disabled,
}: {
  label: string;
  onPress: () => void;
  variant?: 'tonal' | 'primary' | 'danger';
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      className={`items-center rounded-full px-[18px] py-3 active:opacity-80 ${
        variant === 'primary' ? 'bg-pri' : 'bg-surf'
      } ${disabled ? 'opacity-40' : ''}`}
    >
      <Text
        className={`font-sans-bold text-[13px] ${
          variant === 'primary' ? 'text-onpri' : variant === 'danger' ? 'text-danger' : 'text-fg'
        }`}
      >
        {label}
      </Text>
    </Pressable>
  );
}
