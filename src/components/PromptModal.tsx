// A small text-entry dialog that works the same on iOS, Android and the web.
import { useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, TextInput, View } from 'react-native';
import { Button, T } from '@/components/ui';
import { radius, space, useTheme } from '@/lib/theme';

export type Prompt = { title: string; message?: string; initial?: string; placeholder?: string; multiline?: boolean; okLabel?: string; secure?: boolean; onSubmit: (value: string) => void | Promise<void> };

export function PromptModal({ prompt, onClose }: { prompt: Prompt | null; onClose: () => void }) {
  const t = useTheme();
  // Remount the input per prompt so it starts with that prompt's text.
  return (
    <Modal visible={!!prompt} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'center', padding: space.xl }} onPress={onClose}>
          <Pressable onPress={() => {}} style={{ backgroundColor: t.bg, borderRadius: radius.lg, padding: space.lg, gap: space.md, maxWidth: 520, width: '100%', alignSelf: 'center' }}>
            {prompt && <Body key={prompt.title + (prompt.initial ?? '')} prompt={prompt} onClose={onClose} />}
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function Body({ prompt, onClose }: { prompt: Prompt; onClose: () => void }) {
  const t = useTheme();
  const [value, setValue] = useState(prompt.initial ?? '');
  const [busy, setBusy] = useState(false);
  async function submit() {
    setBusy(true);
    try {
      await prompt.onSubmit(value);
      onClose();
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <T size={18} weight="700">{prompt.title}</T>
      {prompt.message ? <T muted size={14}>{prompt.message}</T> : null}
      <TextInput
        value={value}
        onChangeText={setValue}
        placeholder={prompt.placeholder}
        placeholderTextColor={t.muted}
        multiline={prompt.multiline}
        secureTextEntry={prompt.secure}
        autoFocus
        onSubmitEditing={prompt.multiline ? undefined : submit}
        style={{ borderWidth: 1, borderColor: t.border, backgroundColor: t.surface, color: t.ink, borderRadius: radius.md, padding: space.md, fontSize: 16, minHeight: prompt.multiline ? 120 : undefined, textAlignVertical: 'top' }}
        accessibilityLabel={prompt.title}
      />
      <View style={{ flexDirection: 'row', gap: space.sm }}>
        <Button label="Cancel" kind="secondary" onPress={onClose} style={{ flex: 1 }} />
        <Button label={prompt.okLabel ?? 'Save'} onPress={submit} loading={busy} style={{ flex: 1 }} />
      </View>
    </>
  );
}
