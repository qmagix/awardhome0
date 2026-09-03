import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { outbox, onOutboxChange, type Draft } from '@/outbox';
import { useSession } from '@/ui/Session';
import { theme } from '@/ui/theme';

/**
 * The save gate (pivot P1). The account ask comes AFTER the first memory
 * exists — value before commitment — and it can afford to be honest about
 * the stakes because there aren't any: the draft was written to this phone's
 * database the moment it was queued (the M7 outbox), so "already saved on
 * this phone" is a fact, not reassurance copy. Signing in attaches the drafts
 * to the household by dancer name and they send themselves.
 *
 * Declining is allowed. The welcome screen keeps offering the way back in,
 * and nothing typed is ever lost to this gate.
 */
export default function KeepScreen() {
  const { signedIn } = useSession();
  const [drafts, setDrafts] = useState<Draft[]>([]);

  const load = useCallback(async () => {
    const pending = await outbox.pending();
    setDrafts(pending.filter(d => !outbox.isSendable(d)));
  }, []);

  useEffect(() => {
    void load();
    return onOutboxChange(() => { void load(); });
  }, [load]);

  // Signed in and everything attached (or nothing was waiting): this screen
  // has no job left — the outbox shows anything that still needs a person.
  useEffect(() => {
    if (signedIn && drafts.length === 0) router.replace('/household');
  }, [signedIn, drafts.length]);

  const latest = drafts[drafts.length - 1];
  const p = (latest?.payload ?? {}) as {
    dancer_name?: string; performance_name?: string; place?: string; category?: string;
  };

  return (
    <View style={styles.screen}>
      <Text style={styles.h1}>Keep {drafts.length > 1 ? 'these' : 'this'} forever?</Text>
      <Text style={styles.muted}>
        {p.dancer_name ? `${p.dancer_name}’s` : 'Your'} {drafts.length > 1 ? 'memories are' : 'first memory is'} ready.
      </Text>

      {latest && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>
            {p.performance_name ?? 'New memory'}{p.place ? ` — ${p.place}` : ''}
          </Text>
          <Text style={styles.cardMeta}>
            {[p.dancer_name, p.category].filter(Boolean).join(' · ') || 'Saved just now'}
          </Text>
          {drafts.length > 1 && (
            <Text style={styles.cardMeta}>+ {drafts.length - 1} more on this phone</Text>
          )}
        </View>
      )}

      <View style={styles.savedChip}>
        <Text style={styles.savedText}>✓ Already saved on this phone</Text>
      </View>

      <View style={styles.actions}>
        <Pressable
          style={styles.cta}
          onPress={() => router.push({ pathname: '/sign-in', params: { next: '/household' } })}
          accessibilityRole="button"
        >
          <Text style={styles.ctaText}>Create a free account &amp; keep {drafts.length > 1 ? 'them' : 'it'}</Text>
        </Pressable>
        <Pressable
          style={styles.secondary}
          onPress={() => router.push({ pathname: '/sign-in', params: { next: '/household' } })}
          accessibilityRole="button"
        >
          <Text style={styles.secondaryText}>I have an account</Text>
        </Pressable>
        <Pressable onPress={() => router.push('/add')} accessibilityRole="button">
          <Text style={styles.link}>Add another first →</Text>
        </Pressable>
      </View>

      <Text style={styles.note}>
        Nothing you typed is lost either way — your {drafts.length > 1 ? 'drafts stay' : 'draft stays'} right
        here until {drafts.length > 1 ? 'they have' : 'it has'} a home. One emailed code creates the account;
        there is no password.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.bg, padding: theme.space(2.5) },
  h1: { color: theme.text, fontSize: 24, fontWeight: '700', marginTop: theme.space(1) },
  muted: { color: theme.muted, marginTop: theme.space(0.5), lineHeight: 20 },
  card: {
    backgroundColor: theme.card, borderColor: theme.gold, borderWidth: 1,
    borderRadius: theme.radius, padding: theme.space(2), marginTop: theme.space(2.5),
  },
  cardTitle: { color: theme.text, fontSize: 17, fontWeight: '700' },
  cardMeta: { color: theme.muted, fontSize: 13, marginTop: theme.space(0.5) },
  savedChip: { alignItems: 'center', marginTop: theme.space(2) },
  savedText: { color: theme.good, fontSize: 12, fontWeight: '600', letterSpacing: 0.5 },
  actions: { marginTop: 'auto' },
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
  link: { color: theme.gold, textAlign: 'center', marginTop: theme.space(2) },
  note: {
    color: theme.muted, fontSize: 12, lineHeight: 17, textAlign: 'center',
    marginTop: theme.space(2),
  },
});
