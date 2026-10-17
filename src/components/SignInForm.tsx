import * as ExpoLinking from 'expo-linking';
import { useEffect, useState } from 'react';
import { Linking, StyleSheet, TextInput, View } from 'react-native';
import { Banner, Button, T } from '@/components/ui';
import { ssoForEmail } from '@/lib/api';
import { isWeb } from '@/lib/dialog';
import { isConfigured, supabase } from '@/lib/supabase';
import { radius, space, useTheme } from '@/lib/theme';

/** Email + 6-digit code sign-in, used on the sign-in screen and the AI-connector approval page. */
export function SignInForm() {
  const t = useTheme();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sso, setSso] = useState<{ domain: string; sso: boolean; required: boolean } | null>(null);
  const domain = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ? email.trim().split('@')[1].toLowerCase() : null;

  // Company domains with single sign-on get a "Continue with SSO" button (and no code, if required).
  useEffect(() => {
    if (!domain) return;
    const timer = setTimeout(() => void ssoForEmail(`x@${domain}`).then((r) => setSso({ domain, ...r })).catch(() => undefined), 400);
    return () => clearTimeout(timer);
  }, [domain]);
  const ssoState = sso && sso.domain === domain ? sso : { sso: false, required: false };

  async function signInSso() {
    setBusy(true);
    setError(null);
    const redirectTo = isWeb ? `${window.location.origin}/sso-callback` : ExpoLinking.createURL('sso-callback');
    const { data, error } = await supabase.auth.signInWithSSO({ domain: domain!, options: { redirectTo } });
    setBusy(false);
    if (error || !data?.url) return setError(error?.message ?? 'Single sign-on isn’t available for this domain.');
    if (isWeb) window.location.assign(data.url);
    else await Linking.openURL(data.url);
  }

  async function sendCode() {
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.signInWithOtp({ email: email.trim(), options: { shouldCreateUser: true } });
    setBusy(false);
    if (error) setError(error.message);
    else setStep('code');
  }

  async function verify() {
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.verifyOtp({ email: email.trim(), token: code.trim(), type: 'email' });
    setBusy(false);
    if (error) setError(error.message);
  }

  const input = [styles.input, { borderColor: t.border, backgroundColor: t.surface, color: t.ink }];

  return (
    <View style={{ gap: space.xl }}>
        {!isConfigured && (
          <Banner text="Supabase isn't configured. Copy .env.example to .env and add your project URL and key." />
        )}

        {step === 'email' ? (
          <View style={{ gap: space.md }}>
            <TextInput
              style={input}
              placeholder="you@company.com"
              placeholderTextColor={t.muted}
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              textContentType="emailAddress"
              value={email}
              onChangeText={setEmail}
              accessibilityLabel="Email address"
            />
            {ssoState.sso && <Button label="Continue with single sign-on" onPress={signInSso} loading={busy} />}
            {ssoState.required ? (
              <T muted size={14}>Your company signs in with single sign-on.</T>
            ) : (
              <Button label="Email me a sign-in code" kind={ssoState.sso ? 'ghost' : 'primary'} onPress={sendCode} loading={busy} disabled={!email.includes('@')} />
            )}
          </View>
        ) : (
          <View style={{ gap: space.md }}>
            <T muted>Enter the 6-digit code sent to {email}.</T>
            <TextInput
              style={[input, { letterSpacing: 8, fontSize: 24, textAlign: 'center' }]}
              placeholder="000000"
              placeholderTextColor={t.muted}
              keyboardType="number-pad"
              textContentType="oneTimeCode"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChangeText={setCode}
              accessibilityLabel="Sign-in code"
            />
            <Button label="Sign in" onPress={verify} loading={busy} disabled={code.length < 6} />
            <Button label="Use a different email" kind="ghost" onPress={() => { setStep('email'); setCode(''); }} />
          </View>
        )}

        {error && <Banner text={error} />}
    </View>
  );
}

const styles = StyleSheet.create({
  input: { borderWidth: 1, borderRadius: radius.md, paddingHorizontal: space.lg, paddingVertical: 14, fontSize: 17 },
});
