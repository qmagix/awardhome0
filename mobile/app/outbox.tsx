import { useCallback, useEffect, useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { outbox, onOutboxChange, flushIfPossible, type Draft } from '@/outbox';
import { useSession } from '@/ui/Session';
import { theme } from '@/ui/theme';

/**
 * What is waiting to send.
 *
 * This screen exists because "it saved" and "it reached AwardHome" are
 * different facts, and a family at a venue deserves to see which one is true.
 * Hiding the queue would be friendlier right up until someone drives home
 * assuming a weekend was recorded when it is still sitting on the phone.
 */
export default function OutboxScreen() {
  const { signedIn } = useSession();
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const all = await outbox.pending();
    const stuck = await outbox.stuck();
    const seen = new Set(all.map(d => d.clientSubmissionId));
    setDrafts([...all, ...stuck.filter(d => !seen.has(d.clientSubmissionId))]);
  }, []);

  useEffect(() => {
    void load();
    return onOutboxChange(() => { void load(); });
  }, [load]);

  const sendNow = useCallback(async () => {
    setBusy(true);
    try { await flushIfPossible(); } finally { setBusy(false); void load(); }
  }, [load]);

  return (
    <View style={styles.screen}>
      {drafts.length === 0 ? (
        <Text style={styles.muted}>
          Nothing waiting. Everything you&apos;ve added has reached AwardHome.
        </Text>
      ) : (
        <>
          <Text style={styles.muted}>
            {drafts.length} award{drafts.length === 1 ? '' : 's'} still on this phone. They send
            themselves when you have signal — you don&apos;t have to keep the app open.
          </Text>
          <FlatList
            data={drafts}
            keyExtractor={(d) => d.clientSubmissionId}
            renderItem={({ item }) => {
              const p = item.payload as { performance_name?: string; place?: string; dancer_name?: string };
              const stuck = item.status === 'failed' && item.attempts >= 8;
              // A guest draft (pivot P1): named dancer, no id yet. It is not
              // failing — it is waiting for an account, or for the household
              // dancer this name belongs to.
              const waiting = !outbox.isSendable(item);
              return (
                <View style={styles.card}>
                  <Text style={styles.name}>{p.performance_name ?? 'Award'}</Text>
                  <Text style={styles.meta}>
                    {p.place ? `${p.place} · ` : ''}
                    {waiting
                      ? (signedIn
                        ? `Waiting for ${p.dancer_name ?? 'a dancer'}’s profile in your household`
                        : 'Safe on this phone — create an account to send it')
                      : stuck ? 'Needs your attention' : item.attempts > 0 ? `Retrying (${item.attempts})` : 'Waiting to send'}
                  </Text>
                  {waiting && (
                    <Pressable onPress={() => router.push(signedIn ? '/search' : '/keep')}>
                      <Text style={styles.link}>
                        {signedIn ? `Find and claim ${p.dancer_name ?? 'this dancer'} →` : 'Keep it forever →'}
                      </Text>
                    </Pressable>
                  )}
                  {item.lastError && <Text style={styles.err}>{item.lastError}</Text>}
                  {stuck && (
                    <View style={styles.actions}>
                      <Pressable onPress={() => void outbox.retry(item.clientSubmissionId)}>
                        <Text style={styles.link}>Try again</Text>
                      </Pressable>
                      <Pressable
                        onPress={() => Alert.alert(
                          'Discard this award?',
                          'It has not reached AwardHome, and this cannot be undone.',
                          [
                            { text: 'Keep it', style: 'cancel' },
                            {
                              text: 'Discard',
                              style: 'destructive',
                              onPress: () => void outbox.discard(item.clientSubmissionId),
                            },
                          ],
                        )}
                      >
                        <Text style={[styles.link, { color: theme.danger }]}>Discard</Text>
                      </Pressable>
                    </View>
                  )}
                </View>
              );
            }}
          />
          <Pressable style={styles.cta} onPress={() => void sendNow()} disabled={busy}>
            <Text style={styles.ctaText}>{busy ? 'Sending…' : 'Send now'}</Text>
          </Pressable>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.bg, padding: theme.space(2) },
  muted: { color: theme.muted, lineHeight: 20, marginBottom: theme.space(1.5) },
  card: {
    backgroundColor: theme.card, borderColor: theme.border, borderWidth: 1,
    borderRadius: theme.radius, padding: theme.space(1.5), marginBottom: theme.space(1.25),
  },
  name: { color: theme.text, fontSize: 16, fontWeight: '600' },
  meta: { color: theme.muted, fontSize: 13, marginTop: 3 },
  err: { color: theme.danger, fontSize: 12, marginTop: theme.space(0.5) },
  actions: { flexDirection: 'row', gap: theme.space(2), marginTop: theme.space(1) },
  link: { color: theme.gold },
  cta: {
    backgroundColor: theme.goldSoft, borderColor: theme.gold, borderWidth: 1,
    borderRadius: theme.radius, padding: theme.space(1.5), alignItems: 'center',
  },
  ctaText: { color: theme.gold, fontWeight: '600', fontSize: 16 },
});
