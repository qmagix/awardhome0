import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { getActivity, type ActivityItem } from '@/api/client';
import { useSession } from '@/ui/Session';
import { theme } from '@/ui/theme';

/**
 * "I signed in — where's my dancer?" The web app learned this lesson
 * (features.md, My Dancers dashboard): an account with a claim in flight must
 * see that the claim exists, not land somewhere generic that looks like
 * nothing happened.
 *
 * As of M7 it is also the way into the Add flow and the outbox — "waiting to
 * send" is deliberately visible, because "it saved" and "it reached AwardHome"
 * are different facts and a family at a venue deserves to know which is true.
 */
export default function HouseholdScreen() {
  const { ready, signedIn, email, dancers, signOut, refresh } = useSession();
  const [activity, setActivity] = useState<ActivityItem[]>([]);

  useEffect(() => {
    if (!signedIn) return;
    void getActivity().then((a) => setActivity(a.activity)).catch(() => setActivity([]));
  }, [signedIn]);

  // Re-read on every focus, not just on mount. This screen is where a family
  // comes back to check whether anything moved — a claim approved by a
  // director this morning, or one filed on another device. Loading once at
  // launch means the answer is whatever was true when the app started, which
  // is the wrong answer precisely when she is looking.
  useFocusEffect(
    useCallback(() => {
      if (!signedIn) return;
      void refresh();
      void getActivity().then((a) => setActivity(a.activity)).catch(() => { /* keep what we have */ });
    }, [signedIn, refresh]),
  );

  useEffect(() => {
    if (ready && !signedIn) router.replace('/sign-in');
  }, [ready, signedIn]);

  if (!ready) return <View style={styles.screen}><ActivityIndicator color={theme.gold} /></View>;

  return (
    <View style={styles.screen}>
      <Text style={styles.email}>{email}</Text>

      {/* "No dancers yet" now means exactly that: neither a confirmed dancer
          nor a claim in flight. The old copy pointed at "the list below" from
          inside the empty state, where there was no list — a leftover from
          when /me returned only confirmed dancers and a family with a claim
          in flight was told she had nothing. */}
      {dancers.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.h2}>No dancers yet</Text>
          <Text style={styles.muted}>
            Search for your dancer and tap “This is my dancer”. Once you’ve asked, they’ll appear
            here straight away while your claim is confirmed.
          </Text>
          <Pressable style={styles.cta} onPress={() => router.replace('/')}>
            <Text style={styles.ctaText}>Search for a dancer</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={dancers}
          keyExtractor={(d) => d.unique_id}
          // The server orders these: confirmed first, then pending claims
          // newest-first. A section header appears only when both kinds are
          // present, so the common case (one dancer) stays a plain list.
          renderItem={({ item, index }) => {
            const pending = item.standing === 'pending_claim';
            const firstPending = pending
              && (index === 0 || dancers[index - 1]?.standing !== 'pending_claim');
            const anyConfirmed = dancers.some((d) => d.standing === 'owner');
            return (
              <>
                {index === 0 && anyConfirmed && (
                  <Text style={styles.sectionLabel}>Your dancers</Text>
                )}
                {firstPending && anyConfirmed && (
                  <Text style={styles.sectionLabel}>Waiting to be confirmed</Text>
                )}
                <Pressable
                  style={[styles.card, pending && styles.cardPending]}
                  onPress={() => router.push({ pathname: '/dancer/[id]', params: { id: item.unique_id } })}
                  accessibilityLabel={pending
                    ? `${item.name}, claim pending confirmation`
                    : `${item.name}, ${item.award_count} awards`}
                >
                  <View style={styles.cardTop}>
                    <Text style={styles.name}>{item.name}</Text>
                    {/* A pending dancer must not look like one she manages.
                        Without this the app silently promised her something
                        it had not delivered. */}
                    {pending && <Text style={styles.badge}>Pending</Text>}
                  </View>
                  <Text style={styles.meta}>
                    {item.award_count} award{item.award_count === 1 ? '' : 's'}
                    {/* The studio is DERIVED from affiliation — the app never asks
                        a family to type one (design §6.2). Showing it here is how
                        they confirm we got it right. */}
                    {item.studios.length > 0
                      ? ` · ${item.studios.map((s) => (s.is_independent ? 'Independent' : s.name)).join(', ')}`
                      : ' · no studio on file'}
                  </Text>
                  {pending && (
                    <Text style={styles.pendingHint}>
                      You can add awards now — they’re saved privately and sent once this is approved.
                    </Text>
                  )}
                </Pressable>
              </>
            );
          }}
        />
      )}

      {activity.length > 0 && (
        <View style={styles.activity}>
          <Text style={styles.h2}>Recent</Text>
          {activity.slice(0, 5).map((a) => (
            <Text key={`${a.type}-${a.id}`} style={styles.meta}>
              {a.title ?? a.type} — {a.status}
              {a.note ? ` · ${a.note}` : ''}
            </Text>
          ))}
        </View>
      )}

      <Pressable onPress={() => router.replace('/')}>
        <Text style={[styles.link, { textAlign: 'center', marginTop: theme.space(1.5) }]}>
          ← Search for another dancer
        </Text>
      </Pressable>

      <Pressable style={styles.cta} onPress={() => router.push('/add')}>
        <Text style={styles.ctaText}>Add a missing award</Text>
      </Pressable>
      <Pressable onPress={() => router.push('/outbox')}>
        <Text style={[styles.link, { textAlign: 'center', marginTop: theme.space(1.5) }]}>
          Waiting to send →
        </Text>
      </Pressable>

      <Pressable onPress={() => void signOut()} style={styles.signOut}>
        <Text style={styles.link}>Sign out</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.bg, padding: theme.space(2) },
  email: { color: theme.muted, fontSize: 13, marginBottom: theme.space(1.5) },
  h2: { color: theme.text, fontSize: 18, fontWeight: '600', marginBottom: theme.space(0.5) },
  empty: { paddingVertical: theme.space(3) },
  muted: { color: theme.muted, lineHeight: 20 },
  cardTop: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.space(1),
  },
  cardPending: { borderStyle: 'dashed', opacity: 0.92 },
  badge: {
    color: theme.gold, fontSize: 11, fontWeight: '700', letterSpacing: 0.5,
    textTransform: 'uppercase', borderColor: theme.gold, borderWidth: 1,
    borderRadius: 999, paddingHorizontal: theme.space(0.75), paddingVertical: 2,
  },
  pendingHint: { color: theme.muted, fontSize: 12, marginTop: theme.space(0.75), lineHeight: 17 },
  sectionLabel: {
    color: theme.muted, fontSize: 12, fontWeight: '700', letterSpacing: 1,
    textTransform: 'uppercase', marginTop: theme.space(2), marginBottom: theme.space(0.5),
  },
  card: {
    backgroundColor: theme.card, borderColor: theme.border, borderWidth: 1,
    borderRadius: theme.radius, padding: theme.space(1.5), marginBottom: theme.space(1.5),
  },
  name: { color: theme.text, fontSize: 18, fontWeight: '600' },
  meta: { color: theme.muted, fontSize: 13, marginTop: 3, lineHeight: 18 },
  activity: { borderTopColor: theme.border, borderTopWidth: 1, paddingTop: theme.space(1.5) },
  cta: {
    marginTop: theme.space(2), backgroundColor: theme.goldSoft, borderColor: theme.gold,
    borderWidth: 1, borderRadius: theme.radius, padding: theme.space(1.5), alignItems: 'center',
  },
  ctaText: { color: theme.gold, fontWeight: '600', fontSize: 16 },
  signOut: { paddingVertical: theme.space(2) },
  link: { color: theme.gold },
});
