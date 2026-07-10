import React, { useState } from 'react';
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useTheme } from '../theme/useTheme';
import { shape, space, type } from '../theme/tokens';

export function Composer({ placeholder, onSend }: { placeholder: string; onSend: (text: string) => Promise<void> }) {
  const { t } = useTheme();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async () => {
    const msg = text.trim();
    if (!msg || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSend(msg);
      setText('');
    } catch (e) {
      setError(String(e).slice(0, 160));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View
      style={{
        borderTopWidth: 1,
        borderTopColor: t.outlineVariant,
        backgroundColor: t.surface,
      }}>
      {error && (
        <Pressable onPress={() => setError(null)} style={{ paddingHorizontal: space.lg, paddingTop: space.sm }}>
          <Text style={{ ...type.micro, fontWeight: '400', color: t.danger }} numberOfLines={2}>
            Send failed: {error} — tap to dismiss
          </Text>
        </Pressable>
      )}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'flex-end',
          gap: space.sm,
          paddingHorizontal: space.md,
          paddingVertical: space.sm,
        }}>
        <View
          style={{
            flex: 1,
            flexDirection: 'row',
            alignItems: 'center',
            backgroundColor: t.surfaceContainer,
            borderRadius: shape.full,
            paddingHorizontal: space.sm,
            minHeight: 44,
          }}>
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder={placeholder}
            placeholderTextColor={t.onSurfaceVariant}
            multiline
            style={{ flex: 1, ...type.body, color: t.onSurface, paddingHorizontal: space.sm, maxHeight: 120, paddingVertical: 10 }}
          />
        </View>
        <Pressable
          onPress={send}
          disabled={busy || !text.trim()}
          style={{
            width: 44,
            height: 44,
            borderRadius: shape.full,
            backgroundColor: text.trim() ? t.primary : t.surfaceContainer,
            alignItems: 'center',
            justifyContent: 'center',
          }}>
          {busy ? (
            <ActivityIndicator size="small" color={t.onPrimary} />
          ) : (
            <MaterialIcons name="arrow-upward" size={20} color={text.trim() ? t.onPrimary : t.onSurfaceVariant} />
          )}
        </Pressable>
      </View>
    </View>
  );
}
