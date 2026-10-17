import type { Session } from '@supabase/supabase-js';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { joinDomainTeams } from '@/lib/api';
import { isWeb, notify } from '@/lib/dialog';
import { recoverInterruptedRecording } from '@/lib/recorder';
import { listenForNotificationTaps, registerForPush } from '@/lib/push';
import { supabase } from '@/lib/supabase';
import { flush, startSyncLoop } from '@/lib/sync';
import { useTheme } from '@/lib/theme';

export default function RootLayout() {
  const t = useTheme();
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      if (s) {
        void flush();
        void registerForPush();
        // Join teams that claim this email's verified company domain.
        if (_event === 'SIGNED_IN') void joinDomainTeams().catch(() => undefined);
      }
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  // Recover a recording interrupted by a crash, then keep the upload queue moving.
  useEffect(() => listenForNotificationTaps(), []);

  useEffect(() => {
    recoverInterruptedRecording()
      .then((id) => {
        if (id) notify('Recording recovered', 'The app closed while you were recording. What was captured is saved and will be processed.');
      })
      .catch(() => {});
    return startSyncLoop();
  }, []);

  if (!ready) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: t.bg }}>
        <ActivityIndicator color={t.accent} />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <StatusBar style="auto" />
      {/* On wide browser windows, keep content at a readable width. */}
      <View style={{ flex: 1, backgroundColor: t.bg }}>
      <View style={isWeb ? { flex: 1, width: '100%', maxWidth: 860, alignSelf: 'center' } : { flex: 1 }}>
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: t.bg },
          headerTintColor: t.ink,
          headerShadowVisible: false,
          contentStyle: { backgroundColor: t.bg },
        }}
      >
        <Stack.Protected guard={!!session}>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="record" options={{ presentation: 'fullScreenModal', headerShown: false, gestureEnabled: false }} />
          <Stack.Screen name="recording/[id]" options={{ title: '' }} />
          <Stack.Screen name="project/[id]" options={{ title: '' }} />
          <Stack.Screen name="deck" options={{ title: 'Make a deck', presentation: 'modal' }} />
          <Stack.Screen name="integrations" options={{ title: 'Connections' }} />
          <Stack.Screen name="automations" options={{ title: 'Automations' }} />
          <Stack.Screen name="developers" options={{ title: 'Webhooks & API' }} />
          <Stack.Screen name="alerts" options={{ title: 'Alerts & digest' }} />
          <Stack.Screen name="phone" options={{ title: 'Phone calls' }} />
          <Stack.Screen name="devices" options={{ title: 'Devices' }} />
          <Stack.Screen name="reels/index" options={{ title: 'Highlight reels' }} />
          <Stack.Screen name="reels/[id]" options={{ title: '' }} />
          <Stack.Screen name="team/[id]" options={{ title: '' }} />
          <Stack.Screen name="team/admin" options={{ title: 'Admin console' }} />
          <Stack.Screen name="join" options={{ title: 'Join a team' }} />
          <Stack.Screen name="api-access" options={{ title: 'Claude & ChatGPT' }} />
          <Stack.Screen name="upcoming" options={{ title: 'Upcoming meetings' }} />
          <Stack.Screen name="brief" options={{ title: 'Brief' }} />
          <Stack.Screen name="share" options={{ title: 'Share', presentation: 'modal' }} />
          <Stack.Screen name="templates" options={{ title: 'Summary templates' }} />
          <Stack.Screen name="privacy" options={{ title: 'Privacy & data' }} />
          <Stack.Screen name="import-link" options={{ title: 'Import from a link', presentation: 'modal' }} />
          <Stack.Screen name="notetaker" options={{ title: 'Send a notetaker', presentation: 'modal' }} />
          <Stack.Screen name="followup" options={{ title: 'Follow-up email', presentation: 'modal' }} />
        </Stack.Protected>
        <Stack.Protected guard={!session}>
          <Stack.Screen name="sign-in" options={{ headerShown: false }} />
        </Stack.Protected>
        {/* Reachable signed in or out: it shows its own sign-in form. */}
        <Stack.Screen name="oauth/authorize" options={{ headerShown: false }} />
        {/* Public pages for people without an account: shared notes and consent links. */}
        <Stack.Screen name="s/[token]" options={{ headerShown: false }} />
        <Stack.Screen name="sso-callback" options={{ headerShown: false }} />
        <Stack.Screen name="h/[token]" options={{ headerShown: false }} />
        <Stack.Screen name="c/[token]" options={{ headerShown: false }} />
      </Stack>
      </View>
      </View>
    </SafeAreaProvider>
  );
}
