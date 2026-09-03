import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Link, Redirect, router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { outbox, onOutboxChange } from '@/outbox';
import { useSession } from '@/ui/Session';
import { theme } from '@/ui/theme';

/**
 * The first screen (pivot P1): two buttons, no tour, no search box, no
 * account wall. The app opens on DOING — add an award or milestone — because
 * that is the value, and because the alternative first screens can fail:
 * a search box comes back empty for every family outside the scraped orgs,
 * and an account wall asks for commitment before anything has been given.
 *
 * A returning family never sees this at all: the refresh token in secure
 * storage signs them in and they land in their household.
 */
export default function WelcomeScreen() {
  const insets = useSafeAreaInsets();
  const { ready, signedIn } = useSession();
  const [waiting, setWaiting] = useState(0);

  const loadCounts = useCallback(async () => {
    try {
      const c = await outbox.counts();
      setWaiting(c.waiting);
    } catch {
      // No queue is not an error on this screen; the buttons still work.
    }
  }, []);

  useEffect(() => {
    void loadCounts();
    return onOutboxChange(() => { void loadCounts(); });
  }, [loadCounts]);

  if (!ready) {
    return (
      <View style={[styles.screen, styles.center]}>
        <ActivityIndicator color={theme.gold} />
      </View>
    );
  }

  // Auto-login: a device with a live session goes straight to its Space.
  if (signedIn) return <Redirect href="/household" />;

  return (
    <View style={[styles.screen, { paddingTop: insets.top ? 0 : theme.space(2) }]}>
      <View style={styles.hero}>
        <View style={styles.coin}><Text style={styles.coinText}>A</Text></View>
        <Text style={styles.brand}>
          Award<Text style={styles.brandGold}>Home</Text>
        </Text>
        <Text style={styles.lede}>
          Every award and milestone your kid ever earned — kept, privately, forever.
        </Text>
      </View>

      {waiting > 0 && (
        <Pressable style={styles.resume} onPress={() => router.push('/keep')} accessibilityRole="button">
          <Text style={styles.resumeText}>
            {waiting} memor{waiting === 1 ? 'y' : 'ies'} saved on this phone — keep {waiting === 1 ? 'it' : 'them'} forever →
          </Text>
        </Pressable>
      )}

      <View style={styles.actions}>
        <Pressable
          style={styles.cta}
          onPress={() => router.push('/add')}
          accessibilityRole="button"
          accessibilityLabel="Add an award or milestone, no account needed"
        >
          <Text style={styles.ctaText}>Add an award or milestone</Text>
        </Pressable>
        <Pressable
          style={styles.secondary}
          onPress={() => router.push('/sign-in')}
          accessibilityRole="button"
        >
          <Text style={styles.secondaryText}>Sign in</Text>
        </Pressable>
        <Text style={styles.note}>
          No account needed to start. Everything you add is private to your family.
        </Text>
        <Link href="/search" style={styles.link}>Look up a dancer in the archive →</Link>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.bg, padding: theme.space(3) },
  center: { alignItems: 'center', justifyContent: 'center' },
  hero: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  coin: {
    width: 84, height: 84, borderRadius: 42, backgroundColor: theme.gold,
    alignItems: 'center', justifyContent: 'center',
  },
  coinText: { color: theme.bg, fontSize: 40, fontWeight: '800' },
  brand: { color: theme.text, fontSize: 30, fontWeight: '800', marginTop: theme.space(2.5) },
  brandGold: { color: theme.gold },
  lede: {
    color: theme.muted, fontSize: 15, lineHeight: 22, textAlign: 'center',
    marginTop: theme.space(1.5), maxWidth: 280,
  },
  resume: {
    backgroundColor: theme.goldSoft, borderColor: theme.gold, borderWidth: 1,
    borderRadius: theme.radius, padding: theme.space(1.5), marginBottom: theme.space(1.5),
  },
  resumeText: { color: theme.gold, fontWeight: '600', textAlign: 'center' },
  actions: { paddingBottom: theme.space(2) },
  cta: {
    backgroundColor: theme.gold, borderRadius: theme.radius,
    padding: theme.space(2), alignItems: 'center',
  },
  ctaText: { color: theme.bg, fontWeight: '700', fontSize: 16 },
  secondary: {
    borderColor: theme.border, borderWidth: 1, borderRadius: theme.radius,
    padding: theme.space(1.75), alignItems: 'center', marginTop: theme.space(1.25),
  },
  secondaryText: { color: theme.text, fontWeight: '600', fontSize: 15 },
  note: {
    color: theme.muted, fontSize: 12, lineHeight: 17, textAlign: 'center',
    marginTop: theme.space(2),
  },
  link: { color: theme.gold, textAlign: 'center', marginTop: theme.space(2), fontSize: 14 },
});
