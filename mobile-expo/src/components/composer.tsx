import React, { useState } from 'react';
import { TextInput as RNTextInput } from 'react-native';
import { View, Text, Pressable } from '@/tw';
import { useTheme } from '@/theme/use-theme';
import { toast } from '@/components/ui';

// Docked pill composer + filled send (mobile.js .mcompose, ≥44px targets).
export function Composer({
  placeholder,
  onSend,
}: {
  placeholder: string;
  onSend: (text: string) => Promise<void>;
}) {
  const { c } = useTheme();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  const send = async () => {
    const t = text.trim();
    if (!t || busy) return;
    setBusy(true);
    try {
      await onSend(t);
      setText('');
    } catch (e) {
      toast(`Send failed: ${String(e).slice(0, 80)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View className="flex-row items-center gap-2.5 px-4 pb-3 pt-2.5">
      {/* plain RNTextInput: the css element wasn't applying horizontal
          padding on Android, leaving the placeholder ~7dp from the edge
          instead of the reference's 18px inset */}
      <RNTextInput
        style={{
          flex: 1,
          minHeight: 46,
          borderRadius: 999,
          backgroundColor: c.surf,
          paddingHorizontal: 18,
          paddingVertical: 12,
          fontFamily: 'InstrumentSans_400Regular',
          fontSize: 14,
          color: c.fg,
        }}
        placeholder={placeholder}
        placeholderTextColor={c.fg3}
        value={text}
        onChangeText={setText}
        onSubmitEditing={send}
        submitBehavior="submit"
        multiline={false}
      />
      <Pressable
        onPress={send}
        disabled={busy}
        className={`h-[46px] w-[46px] items-center justify-center rounded-2xl bg-pri ${busy ? 'opacity-50' : 'active:opacity-80'}`}
      >
        <Text className="text-[17px] text-onpri">➤</Text>
      </Pressable>
    </View>
  );
}
