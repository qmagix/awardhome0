import { useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { auth } from '@/api/client';
import { useSession } from '@/ui/Session';
import { theme } from '@/ui/theme';

/**
 * Emailed one-time code — no password (design §6.1). The server answers
 * identically whether or not the address has an account, so this screen must
 * not imply otherwise: after requesting a code it always says "check your
 * email", because telling a stranger which families are registered is not
 * something the sign-in screen gets to leak either.
 */
export default function SignInScreen() {
  const { next } = useLocalSearchParams<{ next?: string }>();
  const { refresh } = useSession();
  const [stage, setStage] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [devCode, setDevCode] = useState<string | null>(null);

  const send = async () => {
    setBusy(true); setError(null);
    try {
      const res = await auth.requestCode(email.trim());
      // Development convenience: a non-production server hands the code back
      // instead of mailing it, so a simulator can sign in with no mail
      // provider. Prefilling it is the difference between the app being
      // testable on a simulator and not.
      if (res.devCode) { setCode(res.devCode); setDevCode(res.devCode); }
      setStage('code');
    } catch {
      setError('We couldn’t reach AwardHome. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    setBusy(true); setError(null);
    try {
      await auth.verifyCode(email.trim(), code.trim(), {
        label: Platform.select({ ios: 'iPhone', android: 'Android phone', default: 'Device' }),
        platform: Platform.OS,
      });
      await refresh();
      if (typeof next === 'string' && next.startsWith('/')) router.replace(next as never);
      else router.replace('/household');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That code did not work.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.screen}>
      {stage === 'email' ? (
        <>
          <Text style={styles.h1}>Sign in or get started</Text>
          <Text style={styles.muted}>
            We’ll email you a six-digit code. No password to remember — and if you’ve never used
            AwardHome, entering the code creates your account.
          </Text>
          <TextInput
            value={email}
            onChangeText={setEmail}
            placeholder="you@example.com"
            placeholderTextColor={theme.muted}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            textContentType="emailAddress"
            style={styles.input}
            accessibilityLabel="Email address"
          />
          <Pressable style={styles.cta} onPress={send} disabled={busy || email.trim().length < 5}>
            {busy ? <ActivityIndicator color={theme.gold} /> : <Text style={styles.ctaText}>Email me a code</Text>}
          </Pressable>
        </>
      ) : (
        <>
          <Text style={styles.h1}>Check your email</Text>
          <Text style={styles.muted}>
            A code is on its way to {email.trim()}. It works once and expires in ten minutes.
          </Text>
          <TextInput
            value={code}
            onChangeText={setCode}
            placeholder="123456"
            placeholderTextColor={theme.muted}
            keyboardType="number-pad"
            textContentType="oneTimeCode"
            maxLength={6}
            style={[styles.input, styles.codeInput]}
            accessibilityLabel="Six-digit sign-in code"
          />
          <Pressable style={styles.cta} onPress={verify} disabled={busy || code.trim().length !== 6}>
            {busy ? <ActivityIndicator color={theme.gold} /> : <Text style={styles.ctaText}>Sign in</Text>}
          </Pressable>
          {devCode && (
            <Text style={styles.dev}>
              Development server: no email was sent, so the code is filled in for you.
            </Text>
          )}
          <Pressable onPress={() => { setStage('email'); setCode(''); setDevCode(null); }}>
            <Text style={styles.link}>Use a different email</Text>
          </Pressable>
        </>
      )}
      {error && <Text style={styles.error}>{error}</Text>}

      {/* Always an escape. This screen is reached with router.replace() from
          the household screen, so there may be no back button on the stack —
          without this, a family that opened it by accident is stuck. */}
      <Pressable onPress={() => router.replace('/')} style={styles.escape}>
        <Text style={styles.link}>← Back</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.bg, padding: theme.space(2.5) },
  h1: { color: theme.text, fontSize: 24, fontWeight: '700' },
  muted: { color: theme.muted, marginTop: theme.space(1), lineHeight: 20 },
  input: {
    marginTop: theme.space(2), backgroundColor: 'rgba(0,0,0,0.35)', borderColor: theme.border,
    borderWidth: 1, borderRadius: theme.radius, color: theme.text, padding: theme.space(1.5), fontSize: 16,
  },
  codeInput: { fontSize: 28, letterSpacing: 8, textAlign: 'center' },
  cta: {
    marginTop: theme.space(2), backgroundColor: theme.goldSoft, borderColor: theme.gold,
    borderWidth: 1, borderRadius: theme.radius, padding: theme.space(1.5), alignItems: 'center',
  },
  ctaText: { color: theme.gold, fontWeight: '600', fontSize: 16 },
  link: { color: theme.gold, marginTop: theme.space(2), textAlign: 'center' },
  error: { color: theme.danger, marginTop: theme.space(2) },
  dev: { color: theme.muted, fontSize: 12, marginTop: theme.space(1.5), textAlign: 'center' },
  escape: { marginTop: theme.space(3), alignItems: 'center' },
});
