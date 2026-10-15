import { KeyboardAvoidingView, Platform, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { SignInForm } from '@/components/SignInForm';
import { T } from '@/components/ui';
import { APP_NAME } from '@/lib/config';
import { space, useTheme } from '@/lib/theme';

// Email + 6-digit code. No passwords, no passkeys, no deep links to break.
export default function SignIn() {
  const t = useTheme();
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.wrap}>
        <View style={{ gap: space.sm }}>
          <T size={34} weight="700">{APP_NAME}</T>
          <T muted size={17}>Record conversations. Get notes you can trust and tasks that get done.</T>
        </View>
        <SignInForm />
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, padding: space.xl, justifyContent: 'center', gap: space.xl },
});
