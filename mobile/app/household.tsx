import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
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
  const { ready, signedIn, email, dancers, signOut } = useSession();
  const [activity, setActivity] = useState<ActivityItem[]>([]);

  useEffect(() => {
    if (!signedIn) return;
    void getActivity().then((a) => setActivity(a.activity)).catch(() => setActivity([]));
  }, [signedIn]);

  useEffect(() => {
    if (ready && !signedIn) router.replace('/sign-in');
  }, [ready, signedIn]);

  if (!ready) return <View style={styles.screen}><ActivityIndicator color={theme.gold} /></View>;

  return (
    <View style={styles.screen}>
      <Text style={styles.email}>{email}</Text>

      {dancers.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.h2}>No dancers yet</Text>
          <Text style={styles.muted}>
            Search for your dancer and tap “This is my dancer”. If you’ve already asked, it’s in
            the list below while it’s reviewed.
          </Text>
          <Pressable style={styles.cta} onPress={() => router.replace('/')}>
            <Text style={styles.ctaText}>Search for a dancer</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={dancers}
          keyExtractor={(d) => d.unique_id}
          renderItem={({ item }) => (
            <Pressable
              style={styles.card}
              onPress={() => router.push({ pathname: '/dancer/[id]', params: { id: item.unique_id } })}
            >
              <Text style={styles.name}>{item.name}</Text>
              <Text style={styles.meta}>
                {item.award_count} award{item.award_count === 1 ? '' : 's'}
                {/* The studio is DERIVED from affiliation — the app never asks
                    a family to type one (design §6.2). Showing it here is how
                    they confirm we got it right. */}
                {item.studios.length > 0
                  ? ` · ${item.studios.map((s) => (s.is_independent ? 'Independent' : s.name)).join(', ')}`
                  : ' · no studio on file'}
              </Text>
            </Pressable>
          )}
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
