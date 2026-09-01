import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, Share, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import Constants from 'expo-constants';
import { getTrophyCase, type Award } from '@/api/client';
import { useSession } from '@/ui/Session';
import { theme } from '@/ui/theme';

/**
 * The trophy case — public, and the destination of the universal link from
 * awardhome.com/dancer/<unique_id>. A family tapping that link from a text
 * message lands here whether or not they have ever opened the app.
 */
export default function TrophyCaseScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { signedIn, dancers } = useSession();
  const [awards, setAwards] = useState<Award[]>([]);
  const [dancer, setDancer] = useState<{ id: number; name: string; is_claimed: boolean } | null>(null);
  const [cursor, setCursor] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (next?: number) => {
    if (!id) return;
    try {
      const res = await getTrophyCase(id, next);
      setDancer(res.dancer);
      setAwards((prev) => (next ? [...prev, ...res.awards] : res.awards));
      setCursor(res.nextCursor);
    } catch {
      setError('We couldn’t load this trophy case.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  const isMine = dancer !== null && dancers.some((d) => d.id === dancer.id);

  if (loading) return <View style={styles.screen}><ActivityIndicator color={theme.gold} /></View>;
  if (error) return <View style={styles.screen}><Text style={styles.error}>{error}</Text></View>;

  return (
    <View style={styles.screen}>
      <Text style={styles.name}>{dancer?.name}</Text>
      <Text style={styles.muted}>
        {awards.length}{cursor ? '+' : ''} award{awards.length === 1 ? '' : 's'}
      </Text>

      {/* Claiming is offered only where it is actually available: an unclaimed
          profile that is not already one of yours. Offering it otherwise
          teaches families to ignore the button. */}
      {dancer && !dancer.is_claimed && !isMine && (
        <Pressable
          style={styles.cta}
          onPress={() => router.push(
            signedIn
              ? { pathname: '/claim/[id]', params: { id: String(dancer.id) } }
              : { pathname: '/sign-in', params: { next: `/claim/${dancer.id}` } },
          )}
          accessibilityRole="button"
        >
          <Text style={styles.ctaText}>This is my dancer</Text>
        </Pressable>
      )}
      {isMine && <Text style={styles.mine}>You manage this profile.</Text>}

      {/* Sharing sends the public URL, not a rendered image. The web page
          carries OpenGraph tags so it unfurls properly in a message — and the
          link keeps working for someone who does not have the app. Evidence is
          never share media; only the public trophy case is shared. */}
      {dancer && (
        <Pressable
          style={styles.secondary}
          onPress={() => {
            const base = (Constants.expoConfig?.extra?.['apiBaseUrl'] as string | undefined)
              ?? 'https://awardhome.com';
            const url = `${base}/dancer/${id}`;
            void Share.share({ message: `${dancer.name}'s trophy case: ${url}`, url });
          }}
          accessibilityRole="button"
        >
          <Text style={styles.secondaryText}>Share this trophy case</Text>
        </Pressable>
      )}

      <FlatList
        data={awards}
        keyExtractor={(a) => String(a.id)}
        onEndReached={() => { if (cursor) void load(cursor); }}
        onEndReachedThreshold={0.4}
        ListEmptyComponent={
          <Text style={styles.muted}>
            Nothing here yet. Competitions publish results at their own pace.
          </Text>
        }
        renderItem={({ item }) => (
          <View style={styles.card}>
            <Text style={styles.place}>{item.place ?? 'Award'}</Text>
            <Text style={styles.routine}>{item.performance_name ?? 'Routine'}</Text>
            <Text style={styles.meta}>
              {[item.event_name, item.event_year, item.studio_name].filter(Boolean).join(' · ')}
            </Text>
            {[item.category, item.award_type].filter(Boolean).length > 0 && (
              <Text style={styles.meta}>{[item.category, item.award_type].filter(Boolean).join(' · ')}</Text>
            )}
            {/* Honest labelling, exactly as the web renders it: an award added
                by a family and not yet corroborated says so. */}
            {item.verification_status === 'family_submitted' && (
              <Text style={styles.badge}>Added by a family · not yet confirmed</Text>
            )}
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.bg, padding: theme.space(2) },
  name: { color: theme.text, fontSize: 24, fontWeight: '700' },
  muted: { color: theme.muted, marginTop: 4, lineHeight: 20 },
  mine: { color: theme.good, marginTop: theme.space(1) },
  error: { color: theme.danger },
  cta: {
    marginTop: theme.space(2), backgroundColor: theme.goldSoft, borderColor: theme.gold,
    borderWidth: 1, borderRadius: theme.radius, padding: theme.space(1.5), alignItems: 'center',
  },
  ctaText: { color: theme.gold, fontWeight: '600', fontSize: 16 },
  card: {
    backgroundColor: theme.card, borderColor: theme.border, borderWidth: 1,
    borderRadius: theme.radius, padding: theme.space(1.5), marginTop: theme.space(1.5),
  },
  place: { color: theme.gold, fontWeight: '700', fontSize: 15 },
  routine: { color: theme.text, fontSize: 17, fontWeight: '600', marginTop: 2 },
  meta: { color: theme.muted, fontSize: 13, marginTop: 3 },
  badge: { color: theme.muted, fontSize: 12, marginTop: theme.space(1), fontStyle: 'italic' },
  secondary: {
    marginTop: theme.space(1.5), borderColor: theme.border, borderWidth: 1,
    borderRadius: theme.radius, padding: theme.space(1.25), alignItems: 'center',
  },
  secondaryText: { color: theme.text },
});
