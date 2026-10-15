import { useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Banner, Button, T } from '@/components/ui';
import { APP_NAME } from '@/lib/config';
import { isConfigured, supabase } from '@/lib/supabase';
import { radius, space, useTheme } from '@/lib/theme';

// Email + 6-digit code. No passwords, no passkeys, no deep links to break.
export default function SignIn() {
  const t = useTheme();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.wrap}>
        <View style={{ gap: space.sm }}>
          <T size={34} weight="700">{APP_NAME}</T>
          <T muted size={17}>Record conversations. Get notes you can trust and tasks that get done.</T>
        </View>

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
            <Button label="Email me a sign-in code" onPress={sendCode} loading={busy} disabled={!email.includes('@')} />
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
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, padding: space.xl, justifyContent: 'center', gap: space.xl },
  input: { borderWidth: 1, borderRadius: radius.md, paddingHorizontal: space.lg, paddingVertical: 14, fontSize: 17 },
});
