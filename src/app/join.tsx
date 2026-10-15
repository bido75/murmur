import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ScrollView, TextInput } from 'react-native';
import { Button, T } from '@/components/ui';
import { acceptInvite } from '@/lib/api';
import { notify } from '@/lib/dialog';
import { radius, space, useTheme } from '@/lib/theme';

export default function Join() {
  const t = useTheme();
  const params = useLocalSearchParams<{ code?: string }>();
  const [code, setCode] = useState(params.code ?? '');
  const [busy, setBusy] = useState(false);

  async function join() {
    setBusy(true);
    try {
      const ws = await acceptInvite(code);
      notify("You're in", 'Team projects now show up in Projects.');
      router.replace({ pathname: '/team/[id]', params: { id: ws } });
    } catch (e) {
      notify("Couldn't join", (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={{ padding: space.xl, gap: space.lg }}>
      <T muted>Enter the code from your invite. You need to be signed in with the email address it was sent to.</T>
      <TextInput
        value={code}
        onChangeText={(v) => setCode(v.toUpperCase())}
        placeholder="XXXXX-XXXXX"
        placeholderTextColor={t.muted}
        autoCapitalize="characters"
        autoCorrect={false}
        maxLength={11}
        style={{ borderWidth: 1, borderColor: t.border, backgroundColor: t.surface, color: t.ink, borderRadius: radius.md, padding: space.md, fontSize: 24, letterSpacing: 4, textAlign: 'center' }}
        accessibilityLabel="Invite code"
      />
      <Button label="Join team" onPress={join} loading={busy} disabled={code.replace('-', '').length < 10} />
    </ScrollView>
  );
}
