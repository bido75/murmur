import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Linking, ScrollView, TextInput, View } from 'react-native';
import { Button, T } from '@/components/ui';
import { draftFollowup } from '@/lib/api';
import { isWeb, notify, shareOrCopy } from '@/lib/dialog';
import { radius, space, useTheme } from '@/lib/theme';

/** A follow-up email written from the confirmed notes; edit it, then copy or open it in your mail app. */
export default function Followup() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const t = useTheme();
  const [tone, setTone] = useState<'friendly' | 'formal'>('friendly');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(true);

  const write = useCallback(async (which: 'friendly' | 'formal') => {
    setBusy(true);
    try {
      const d = await draftFollowup(id, which);
      setSubject(d.subject);
      setBody(d.body);
    } catch (e) {
      notify("Couldn't write the email", (e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [id]);

  useEffect(() => {
    draftFollowup(id, 'friendly')
      .then((d) => {
        setSubject(d.subject);
        setBody(d.body);
      })
      .catch((e) => notify("Couldn't write the email", (e as Error).message))
      .finally(() => setBusy(false));
  }, [id]);

  const field = { borderWidth: 1, borderColor: t.border, backgroundColor: t.surface, color: t.ink, borderRadius: radius.md, padding: space.md, fontSize: 16 } as const;
  const mailto = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

  return (
    <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.md, paddingBottom: space.xxl }}>
      <T muted>Written from the confirmed notes only. Check it, change anything, then send it from your own email.</T>
      <View style={{ flexDirection: 'row', gap: space.sm }}>
        {(['friendly', 'formal'] as const).map((k) => (
          <Button key={k} label={k === 'friendly' ? 'Friendly' : 'Formal'} kind={tone === k ? 'primary' : 'secondary'} onPress={() => { setTone(k); void write(k); }} style={{ flex: 1 }} />
        ))}
      </View>
      <T muted size={13} weight="600">SUBJECT</T>
      <TextInput value={subject} onChangeText={setSubject} editable={!busy} style={field} accessibilityLabel="Subject" />
      <T muted size={13} weight="600">MESSAGE</T>
      <TextInput value={busy ? 'Writing…' : body} onChangeText={setBody} editable={!busy} multiline style={[field, { minHeight: 260, textAlignVertical: 'top' }]} accessibilityLabel="Message" />
      <View style={{ flexDirection: 'row', gap: space.sm }}>
        <Button label="Copy" kind="secondary" disabled={busy} onPress={() => void shareOrCopy(`${subject}\n\n${body}`, 'Email copied')} style={{ flex: 1 }} />
        <Button label={isWeb ? 'Open in email' : 'Open in Mail'} disabled={busy} onPress={() => void Linking.openURL(mailto)} style={{ flex: 1 }} />
      </View>
    </ScrollView>
  );
}
