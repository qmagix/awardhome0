import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import {
  claimStudio, getStudio, type Award, type StudioEvent, type StudioSummary,
} from '@/api/client';
import { useSession } from '@/ui/Session';
import { theme } from '@/ui/theme';

type Studio = StudioSummary & {
  bio: string | null; website_url: string | null; is_mine: boolean;
};

/**
 * A studio, and the way a director claims it from a phone.
 *
 * This exists because 21,693 of 21,695 real studios are unclaimed, which is
 * not a cold-start curiosity — an unclaimed studio is one where NOBODY reviews
 * that studio's families' submissions, so every one of them falls to AwardHome.
 * The person most likely to fix that is a director who just heard about this
 * from one of their own parents, standing in a studio lobby with a phone.
 * Sending them to a desktop is where that ends.
 */
export default function StudioScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { signedIn } = useSession();
  const [studio, setStudio] = useState<Studio | null>(null);
  const [stats, setStats] = useState<{ awards: number; events: number; dancers: number } | null>(null);
  const [events, setEvents] = useState<StudioEvent[]>([]);
  const [awards, setAwards] = useState<Award[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [contactName, setContactName] = useState('');
  const [role, setRole] = useState('');
  const [address, setAddress] = useState('');
  const [proof, setProof] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ status: string; reason?: string } | null>(null);

  useEffect(() => {
    if (!id) return;
    void getStudio(id)
      .then((r) => {
        setStudio(r.studio); setStats(r.stats);
        setEvents(r.recentEvents); setAwards(r.recentAwards);
      })
      .catch(() => setError('We couldn’t load this studio.'))
      .finally(() => setLoading(false));
  }, [id]);

  const submit = useCallback(async () => {
    if (!id) return;
    setBusy(true); setError(null);
    try {
      const res = await claimStudio(id, {
        contact_name: contactName.trim(),
        role: role.trim(),
        studio_address: address.trim(),
        proof: proof.trim(),
      });
      setDone({ status: res.status, ...(res.reason ? { reason: res.reason } : {}) });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'We couldn’t file that claim.');
    } finally {
      setBusy(false);
    }
  }, [id, contactName, role, address, proof]);

  if (loading) return <View style={styles.screen}><ActivityIndicator color={theme.gold} /></View>;
  if (!studio) return <View style={styles.screen}><Text style={styles.error}>{error ?? 'Not found.'}</Text></View>;

  if (done) {
    return (
      <View style={styles.screen}>
        <Text style={styles.h1}>
          {done.status === 'approved' ? `${studio.name} is yours` : 'Claim sent'}
        </Text>
        <Text style={styles.muted}>
          {done.status === 'approved'
            // The domain fast-track fired: her email domain matches the
            // studio's own website, which is about as good as evidence gets.
            ? 'Your email address is on this studio’s own domain, so we approved it immediately. You can now review the awards families add for your dancers.'
            : 'The AwardHome team will check it and email you — usually quickly. Once it’s yours, you’ll be the one confirming the awards families add for your dancers.'}
        </Text>
        <Pressable style={styles.cta} onPress={() => router.replace('/')}>
          <Text style={styles.ctaText}>Back to search</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={{ paddingBottom: theme.space(6) }}>
      <Text style={styles.h1}>{studio.name}</Text>
      {stats && (
        <Text style={styles.muted}>
          {stats.awards} award{stats.awards === 1 ? '' : 's'} · {stats.dancers} dancer
          {stats.dancers === 1 ? '' : 's'} · {stats.events} event{stats.events === 1 ? '' : 's'}
        </Text>
      )}
      {studio.bio ? <Text style={styles.bio}>{studio.bio}</Text> : null}

      {/* Enough to answer "is this mine?". A name and three counts cannot —
          there are a great many studios with the same name, which is exactly
          why the claim form below asks for an address. Competitions are what a
          director remembers, and the event names carry the city. */}
      {events.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Recently competed at</Text>
          {events.map((e, i) => (
            <Text key={`${e.name}-${i}`} style={styles.row}>
              {e.name}{e.year ? ` · ${e.year}` : ''}
              <Text style={styles.rowMeta}>
                {'  '}{e.award_count} award{e.award_count === 1 ? '' : 's'}
              </Text>
            </Text>
          ))}
        </View>
      )}

      {/* No dancer names on purpose: roster lists are not public, and a page
          whose job is "do you recognise this studio?" is the last place that
          should change. Routines and placements do the recognising. */}
      {awards.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Recent awards</Text>
          {awards.map((a) => {
            const name = a.performance_name
              || [a.category, a.award_type].filter(Boolean).join(' · ');
            return (
              <Text key={a.id} style={styles.row}>
                <Text style={styles.place}>{a.place_display ?? a.place ?? ''}</Text>
                {name ? `  ${name}` : ''}
                {a.event_name ? <Text style={styles.rowMeta}>{`\n${a.event_name}`}</Text> : null}
              </Text>
            );
          })}
        </View>
      )}

      {studio.is_mine ? (
        <Text style={styles.claimed}>You manage this studio.</Text>
      ) : studio.is_claimed ? (
        <View style={styles.pitch}>
          <Text style={styles.pitchTitle}>This studio is already claimed</Text>
          <Text style={styles.muted}>
            {signedIn
              ? 'Someone at the studio manages it. If that should be you, ask them to add you — or contact us and we’ll sort it out.'
              : 'Its director manages it on AwardHome. If that’s you, sign in to pick up where you left off.'}
          </Text>
          {!signedIn && (
            <Pressable
              style={styles.cta}
              onPress={() => router.push({ pathname: '/sign-in', params: { next: `/studio/${id}` } })}
              accessibilityRole="button"
            >
              <Text style={styles.ctaText}>Sign in</Text>
            </Pressable>
          )}
        </View>
      ) : !showForm ? (
        <>
          <View style={styles.pitch}>
            <Text style={styles.pitchTitle}>Is this your studio?</Text>
            <Text style={styles.muted}>
              Claiming it lets you confirm the awards families add for your dancers — and until
              someone does, nobody at the studio sees them at all.
            </Text>
          </View>
          <Pressable
            style={styles.cta}
            onPress={() => (signedIn
              ? setShowForm(true)
              : router.push({ pathname: '/sign-in', params: { next: `/studio/${id}` } }))}
          >
            <Text style={styles.ctaText}>Claim this studio</Text>
          </Pressable>
        </>
      ) : (
        <>
          <Text style={styles.label}>Your name *</Text>
          <TextInput value={contactName} onChangeText={setContactName} style={styles.input} />

          <Text style={styles.label}>Your role</Text>
          <TextInput value={role} onChangeText={setRole} style={styles.input}
            placeholder="Owner, director, office manager" placeholderTextColor={theme.muted} />

          <Text style={styles.label}>Studio address *</Text>
          <TextInput value={address} onChangeText={setAddress} style={styles.input} />
          <Text style={styles.hint}>
            This is how we tell studios with the same name apart — there are a lot of them.
          </Text>

          <Text style={styles.label}>Anything else that helps us confirm</Text>
          <TextInput value={proof} onChangeText={setProof} multiline
            style={[styles.input, styles.multiline]} />
          <Text style={styles.hint}>
            If your email is on the studio’s own website domain, we can approve it on the spot.
          </Text>

          <Pressable
            style={[styles.cta, (!contactName.trim() || !address.trim()) && styles.ctaOff]}
            onPress={() => void submit()}
            disabled={busy || !contactName.trim() || !address.trim()}
          >
            {busy ? <ActivityIndicator color={theme.gold} /> : <Text style={styles.ctaText}>Send claim</Text>}
          </Pressable>
        </>
      )}
      {error && <Text style={styles.error}>{error}</Text>}

      <Pressable onPress={() => router.replace('/')} style={styles.escape}>
        <Text style={styles.link}>← Back to search</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.bg, padding: theme.space(2) },
  h1: { color: theme.text, fontSize: 24, fontWeight: '700' },
  muted: { color: theme.muted, lineHeight: 20, marginTop: theme.space(0.5) },
  bio: { color: theme.text, marginTop: theme.space(1.5), lineHeight: 20 },
  claimed: { color: theme.good, marginTop: theme.space(2) },
  section: { marginTop: theme.space(2.5) },
  sectionLabel: {
    color: theme.muted, fontSize: 12, fontWeight: '700', letterSpacing: 1,
    textTransform: 'uppercase', marginBottom: theme.space(1),
  },
  row: {
    color: theme.text, fontSize: 14, lineHeight: 20,
    paddingVertical: theme.space(0.75),
    borderBottomColor: theme.border, borderBottomWidth: 1,
  },
  rowMeta: { color: theme.muted, fontSize: 12 },
  place: { color: theme.gold, fontWeight: '700' },
  pitch: {
    marginTop: theme.space(2.5), padding: theme.space(1.5),
    backgroundColor: theme.goldSoft, borderRadius: theme.radius,
  },
  pitchTitle: { color: theme.gold, fontWeight: '700', fontSize: 16, marginBottom: theme.space(0.5) },
  label: { color: theme.text, fontWeight: '600', marginTop: theme.space(2), marginBottom: theme.space(0.5) },
  hint: { color: theme.muted, fontSize: 12, marginTop: theme.space(0.5), lineHeight: 17 },
  input: {
    backgroundColor: 'rgba(0,0,0,0.35)', borderColor: theme.border, borderWidth: 1,
    borderRadius: theme.radius, color: theme.text, padding: theme.space(1.5), fontSize: 16,
  },
  multiline: { minHeight: 70, textAlignVertical: 'top' },
  cta: {
    marginTop: theme.space(2), backgroundColor: theme.goldSoft, borderColor: theme.gold,
    borderWidth: 1, borderRadius: theme.radius, padding: theme.space(1.5), alignItems: 'center',
  },
  ctaOff: { opacity: 0.4 },
  ctaText: { color: theme.gold, fontWeight: '600', fontSize: 16 },
  error: { color: theme.danger, marginTop: theme.space(2) },
  escape: { marginTop: theme.space(3), alignItems: 'center' },
  link: { color: theme.gold },
});
