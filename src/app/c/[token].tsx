// Public consent page: someone invited to a recorded meeting says yes or no. No account needed.
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, TextInput, View } from 'react-native';
import { Button, Card, T } from '@/components/ui';
import { publicCall } from '@/lib/api';
import { radius, space, useTheme } from '@/lib/theme';

type Info = { title: string; organizer: string | null; app: string };

export default function Consent() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const t = useTheme();
  const [info, setInfo] = useState<Info | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [done, setDone] = useState<'agree' | 'decline' | null>(null);
  const [busy, setBusy] = useState<'agree' | 'decline' | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    publicCall<Info>(`consent?token=${encodeURIComponent(token ?? '')}`)
      .then(setInfo)
      .catch((e) => setError((e as Error).message));
  }, [token]);

  async function answer(decision: 'agree' | 'decline') {
    setBusy(decision);
    setFormError(null);
    try {
      await publicCall('consent', { method: 'POST', body: { token, name, email, decision } });
      setDone(decision);
    } catch (e) {
      setFormError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const input = { borderWidth: 1, borderColor: t.border, backgroundColor: t.surface, color: t.ink, borderRadius: radius.md, padding: space.md, fontSize: 16 } as const;

  if (error) {
    return (
      <View style={{ flex: 1, padding: space.xl, justifyContent: 'center', gap: space.md, backgroundColor: t.bg }}>
        <T size={22} weight="700">This link isn’t working</T>
        <T muted>{error}</T>
      </View>
    );
  }
  if (!info) return <ActivityIndicator style={{ flex: 1 }} color={t.accent} />;

  return (
    <ScrollView style={{ backgroundColor: t.bg }} contentContainerStyle={{ padding: space.xl, gap: space.lg, maxWidth: 560, width: '100%', alignSelf: 'center' }}>
      <T muted size={13} weight="600">RECORDING CONSENT</T>
      <T size={26} weight="700">{info.title}</T>
      <T size={16}>
        {info.organizer ?? 'The organizer'} would like to record this meeting with {info.app} to take accurate notes. The recording, transcript and notes are
        kept by them (and their team, if it’s a team project). They aren’t used to train AI models.
      </T>
      {done ? (
        <Card style={{ gap: space.sm, borderColor: done === 'agree' ? t.accent : t.danger }}>
          <T size={18} weight="700">{done === 'agree' ? 'Thanks, you agreed to be recorded.' : 'Got it, you don’t agree to be recorded.'}</T>
          <T muted>
            {done === 'agree'
              ? 'You can change your mind at any time: tell the organizer and ask them to stop or delete the recording.'
              : 'The organizer can see your answer. If they record anyway, you can ask them to stop.'}
          </T>
        </Card>
      ) : (
        <Card style={{ gap: space.md }}>
          <TextInput value={name} onChangeText={setName} placeholder="Your name" placeholderTextColor={t.muted} style={input} accessibilityLabel="Your name" autoComplete="name" />
          <TextInput value={email} onChangeText={setEmail} placeholder="Email (optional)" placeholderTextColor={t.muted} style={input} autoCapitalize="none" keyboardType="email-address" accessibilityLabel="Email" autoComplete="email" />
          {formError ? <T size={14} style={{ color: t.danger }}>{formError}</T> : null}
          <Button label="I agree to be recorded" onPress={() => void answer('agree')} loading={busy === 'agree'} disabled={!name.trim()} />
          <Button label="I don’t agree" kind="secondary" onPress={() => void answer('decline')} loading={busy === 'decline'} disabled={!name.trim()} />
        </Card>
      )}
    </ScrollView>
  );
}
