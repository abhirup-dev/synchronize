import React, { useState } from 'react';
import { View, Text, TextInput, Pressable } from '@/tw';
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
      <TextInput
        className="min-h-[46px] flex-1 rounded-full bg-surf px-[18px] py-3 font-sans text-[14px] text-fg"
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
