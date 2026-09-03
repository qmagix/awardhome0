import { useCallback, useState } from 'react';
import {
  ActivityIndicator, FlatList, Pressable, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { Link, router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { searchDancers, searchStudios, type DancerSummary, type StudioSummary } from '@/api/client';
import { useSession } from '@/ui/Session';
import { theme } from '@/ui/theme';

/**
 * The archive door (pivot P1: no longer the first screen). Search still works
 * with no account (design §6.1) — a parent types their child's name, sees the
 * trophy case, and only then decides whether the app is worth an account. But
 * it is reached from the welcome screen now, not forced on arrival: for every
 * family outside the scraped orgs, a search box that can come back empty is a
 * first screen that can fail.
 */
export default function SearchScreen() {
  const insets = useSafeAreaInsets();
  const { signedIn, dancers } = useSession();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<DancerSummary[]>([]);
  const [studios, setStudios] = useState<StudioSummary[]>([]);
  const [state, setState] = useState<'idle' | 'searching' | 'done' | 'error'>('idle');

  const run = useCallback(async (q: string) => {
    if (q.trim().length < 2) { setResults([]); setState('idle'); return; }
    setState('searching');
    try {
      // Both, in one pass. A parent is looking for a child; a director is
      // looking for their studio. Neither should have to know which tab to be
      // on to find the thing they came for.
      const [d, s2] = await Promise.all([searchDancers(q.trim()), searchStudios(q.trim())]);
      setResults(d.dancers);
      setStudios(s2.studios);
      setState('done');
    } catch {
      setState('error');
    }
  }, []);

  return (
    <View style={[styles.screen, { paddingTop: insets.top ? 0 : theme.space(2) }]}>
      <Text style={styles.lede}>All their awards, one lasting home.</Text>

      <TextInput
        value={query}
        onChangeText={(t) => { setQuery(t); void run(t); }}
        placeholder="Search a dancer or a studio"
        placeholderTextColor={theme.muted}
        autoCorrect={false}
        autoCapitalize="words"
        style={styles.input}
        returnKeyType="search"
        accessibilityLabel="Search for a dancer or a studio by name"
      />

      {state === 'searching' && <ActivityIndicator color={theme.gold} style={{ marginTop: theme.space(2) }} />}
      {state === 'error' && <Text style={styles.error}>We couldn&apos;t reach AwardHome. Please try again.</Text>}
      {state === 'done' && results.length === 0 && studios.length === 0 && (
        <Text style={styles.muted}>
          Nothing by that name yet. Competitions publish results at different speeds — try a
          different spelling, or check back after the next event.
        </Text>
      )}

      {state === 'done' && studios.length > 0 && (
        <View style={styles.studios}>
          <Text style={styles.sectionLabel}>Studios</Text>
          {studios.slice(0, 3).map((s2) => (
            <Pressable
              key={s2.unique_id}
              style={styles.row}
              onPress={() => router.push({ pathname: '/studio/[id]', params: { id: s2.unique_id } })}
              accessibilityRole="button"
            >
              <Text style={styles.rowName}>{s2.name}</Text>
              <Text style={styles.rowMeta}>
                {s2.award_count} award{s2.award_count === 1 ? '' : 's'}
                {s2.is_claimed ? '' : ' · not claimed yet'}
              </Text>
            </Pressable>
          ))}
        </View>
      )}

      <FlatList
        data={results}
        ListHeaderComponent={state === 'done' && results.length > 0
          ? <Text style={styles.sectionLabel}>Dancers</Text> : null}
        keyExtractor={(d) => d.unique_id}
        keyboardShouldPersistTaps="handled"
        renderItem={({ item }) => (
          <Pressable
            style={styles.row}
            onPress={() => router.push({ pathname: '/dancer/[id]', params: { id: item.unique_id } })}
            accessibilityRole="button"
            accessibilityLabel={`${item.name}, ${item.award_count} awards`}
          >
            <Text style={styles.rowName}>{item.name}</Text>
            <Text style={styles.rowMeta}>
              {item.award_count} award{item.award_count === 1 ? '' : 's'}
              {item.studios ? ` · ${item.studios}` : ''}
            </Text>
          </Pressable>
        )}
      />

      <View style={styles.footer}>
        {signedIn ? (
          <Link href="/household" style={styles.link}>
            My dancers{dancers.length ? ` (${dancers.length})` : ''} →
          </Link>
        ) : (
          <Link href="/sign-in" style={styles.link}>Sign in →</Link>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.bg, padding: theme.space(2) },
  lede: { color: theme.text, fontSize: 22, fontWeight: '600', marginBottom: theme.space(2) },
  input: {
    backgroundColor: 'rgba(0,0,0,0.35)', borderColor: theme.border, borderWidth: 1,
    borderRadius: theme.radius, color: theme.text, padding: theme.space(1.5), fontSize: 16,
  },
  row: {
    borderBottomColor: theme.border, borderBottomWidth: 1, paddingVertical: theme.space(1.5),
  },
  rowName: { color: theme.text, fontSize: 17, fontWeight: '600' },
  rowMeta: { color: theme.muted, fontSize: 13, marginTop: 2 },
  muted: { color: theme.muted, marginTop: theme.space(2), lineHeight: 20 },
  error: { color: theme.danger, marginTop: theme.space(2) },
  studios: { marginTop: theme.space(2) },
  sectionLabel: {
    color: theme.muted, fontSize: 12, fontWeight: '700', letterSpacing: 1,
    textTransform: 'uppercase', marginTop: theme.space(1.5), marginBottom: theme.space(0.5),
  },
  footer: { paddingVertical: theme.space(2) },
  link: { color: theme.gold, fontSize: 16 },
});
