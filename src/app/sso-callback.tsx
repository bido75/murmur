import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Banner, Button } from '@/components/ui';
import { supabase } from '@/lib/supabase';
import { space, useTheme } from '@/lib/theme';

/** Back from the company's identity provider: trade the one-time code for a session. */
export default function SsoCallback() {
  const t = useTheme();
  const { code, error_description } = useLocalSearchParams<{ code?: string; error_description?: string }>();
  const [error, setError] = useState<string | null>(error_description ?? (code ? null : 'Sign-in was cancelled.'));
  useEffect(() => {
    if (!code) return;
    supabase.auth.exchangeCodeForSession(code).then(({ error: e }) => {
      if (e) setError(e.message);
      else router.replace('/');
    });
  }, [code]);
  return (
    <View style={{ flex: 1, justifyContent: 'center', padding: space.xl, gap: space.lg, backgroundColor: t.bg }}>
      {error ? (
        <>
          <Banner text={error} />
          <Button label="Back to sign in" onPress={() => router.replace('/sign-in')} />
        </>
      ) : (
        <ActivityIndicator />
      )}
    </View>
  );
}
