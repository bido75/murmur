// Consent page for AI connectors (Claude.ai, ChatGPT, ...). Reached in the browser during
// the OAuth sign-in flow; the user approves and is sent back to the AI app.
import type { Session } from '@supabase/supabase-js';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { SignInForm } from '@/components/SignInForm';
import { Banner, Button, Card, T } from '@/components/ui';
import { APP_NAME, SUPABASE_ANON_KEY, SUPABASE_URL } from '@/lib/config';
import { supabase } from '@/lib/supabase';
import { space, useTheme } from '@/lib/theme';

const FN = `${SUPABASE_URL}/functions/v1/oauth`;

export default function Authorize() {
  const t = useTheme();
  const params = useLocalSearchParams<Record<string, string>>();
  const [session, setSession] = useState<Session | null>(null);
  const [client, setClient] = useState<{ client_name: string; redirect_host: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'allow' | 'deny' | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  const query = new URLSearchParams(Object.entries(params).filter(([, v]) => typeof v === 'string') as [string, string][]).toString();
  useEffect(() => {
    fetch(`${FN}/client?${query}`, { headers: { apikey: SUPABASE_ANON_KEY } })
      .then(async (r) => {
        const body = await r.json();
        if (!r.ok) setError(body.error_description ?? 'This connection request is not valid.');
        else setClient(body);
      })
      .catch(() => setError("Couldn't reach the server."));
  }, [query]);

  async function decide(decision: 'allow' | 'deny') {
    if (!session) return;
    setBusy(decision);
    try {
      const r = await fetch(`${FN}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ params, decision }),
      });
      const body = await r.json();
      if (!r.ok || !body.redirect) throw new Error(body.error_description ?? 'Approval failed');
      window.location.assign(body.redirect);
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  }

  return (
    <ScrollView contentContainerStyle={{ padding: space.xl, gap: space.xl, maxWidth: 520, width: '100%', alignSelf: 'center' }}>
      <T size={28} weight="700">{APP_NAME}</T>
      {error ? (
        <Banner text={error} />
      ) : !client ? (
        <T muted>Checking the request…</T>
      ) : !session ? (
        <View style={{ gap: space.lg }}>
          <T size={17}>Sign in to connect <T size={17} weight="700">{client.client_name}</T>.</T>
          <SignInForm />
        </View>
      ) : (
        <Card style={{ gap: space.lg }}>
          <T size={18}>
            <T size={18} weight="700">{client.client_name}</T> wants to access your {APP_NAME} account
          </T>
          <View style={{ gap: space.sm }}>
            <T>It will be able to:</T>
            <T>•  Search and read your recordings, transcripts and notes, including team projects</T>
            <T>•  See your tasks and mark them done</T>
          </View>
          <T muted size={14}>
            Signed in as {session.user.email}. You’ll go back to {client.redirect_host}. You can disconnect it any time in Settings.
          </T>
          <Button label="Allow" onPress={() => void decide('allow')} loading={busy === 'allow'} disabled={!!busy} />
          <Button label="Deny" kind="ghost" onPress={() => void decide('deny')} loading={busy === 'deny'} disabled={!!busy} />
        </Card>
      )}
      <T muted size={12} style={{ color: t.muted }}>Only approve apps you started connecting yourself.</T>
    </ScrollView>
  );
}
