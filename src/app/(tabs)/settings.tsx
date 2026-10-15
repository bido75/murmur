import { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, Switch, View } from 'react-native';
import { Button, Card, T } from '@/components/ui';
import { getSettings, saveSettings, type Settings } from '@/lib/api';
import { APP_NAME } from '@/lib/config';
import { supabase } from '@/lib/supabase';
import { flush, pendingOps } from '@/lib/sync';
import { radius, space, useTheme } from '@/lib/theme';
import { TEMPLATE_LABELS, type Template } from '@/lib/types';

export default function SettingsScreen() {
  const t = useTheme();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [pending, setPending] = useState(0);

  useEffect(() => {
    getSettings().then(setSettings);
    supabase.auth.getUser().then(({ data }) => setEmail(data.user?.email ?? null));
    pendingOps().then((ops) => setPending(ops.filter((o) => o.kind === 'segment').length));
  }, []);

  function update(patch: Partial<Settings>) {
    if (!settings) return;
    const next = { ...settings, ...patch };
    setSettings(next);
    void saveSettings(next);
  }

  if (!settings) return null;

  return (
    <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg }}>
      <Card style={{ gap: space.md }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
          <View style={{ flex: 1 }}>
            <T weight="600">Recording notice</T>
            <T muted size={14}>Remind me to tell people before I record</T>
          </View>
          <Switch
            value={settings.consentReminder}
            onValueChange={(v) => update({ consentReminder: v })}
            trackColor={{ true: t.accent, false: t.border }}
            accessibilityLabel="Recording notice reminder"
          />
        </View>
      </Card>

      <Card style={{ gap: space.md }}>
        <T weight="600">Default type</T>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
          {(Object.keys(TEMPLATE_LABELS) as Template[]).map((k) => {
            const on = settings.defaultTemplate === k;
            return (
              <Pressable
                key={k}
                accessibilityRole="radio"
                accessibilityState={{ selected: on }}
                onPress={() => update({ defaultTemplate: k })}
                style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.pill, borderWidth: 1, borderColor: on ? t.accent : t.border, backgroundColor: on ? t.accentSoft : 'transparent' }}
              >
                <T size={14} style={{ color: on ? t.accent : t.ink }}>{TEMPLATE_LABELS[k]}</T>
              </Pressable>
            );
          })}
        </View>
      </Card>

      <Card style={{ gap: space.sm }}>
        <T weight="600">Uploads</T>
        <T muted size={14}>{pending ? `${pending} audio part${pending > 1 ? 's' : ''} waiting to upload.` : 'Everything is uploaded.'}</T>
        {pending > 0 && <Button label="Retry now" kind="secondary" onPress={() => void flush().then(() => pendingOps()).then((o) => setPending(o.filter((x) => x.kind === 'segment').length))} />}
      </Card>

      <Card style={{ gap: space.sm }}>
        <T weight="600">Account</T>
        <T muted size={14}>{email ?? ''}</T>
        <T muted size={13}>Your recordings are private to your account and are never used to train AI models.</T>
        <Button
          label="Sign out"
          kind="secondary"
          onPress={() =>
            Alert.alert('Sign out?', 'Recordings waiting to upload stay on this phone and upload after you sign back in.', [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Sign out', style: 'destructive', onPress: () => void supabase.auth.signOut() },
            ])
          }
        />
      </Card>

      <T muted size={12} style={{ textAlign: 'center' }}>{APP_NAME} · MVP build</T>
    </ScrollView>
  );
}
