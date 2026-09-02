import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import {
  claimStudio, getStudio, uploadClaimPhoto,
  type Award, type StudioEvent, type StudioSummary,
} from '@/api/client';
import { useSession } from '@/ui/Session';
import { theme } from '@/ui/theme';

type Studio = StudioSummary & {
  bio: string | null; website_url: string | null; is_mine: boolean;
  manager: { name: string; role: string | null } | null;
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
  const [showPublicly, setShowPublicly] = useState(true);
  const [photo, setPhoto] = useState<{ uri: string; mimeType?: string } | null>(null);
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
        show_publicly: showPublicly,
      });
      // After the claim exists, not before — the upload attaches to a pending
      // claim, and a photo with nothing to attach to is just an orphan file.
      // A failed photo must not fail the claim: the claim is the thing.
      if (photo) {
        try { await uploadClaimPhoto(id, photo); } catch { /* claim still stands */ }
      }
      setDone({ status: res.status, ...(res.reason ? { reason: res.reason } : {}) });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'We couldn’t file that claim.');
    } finally {
      setBusy(false);
    }
  }, [id, contactName, role, address, proof, showPublicly, photo]);

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
    <ScrollView
      style={styles.screen}
      contentContainerStyle={{ paddingBottom: theme.space(6) }}
      // The claim block is child index 1 and STICKS to the top. The action was
      // previously below the awards preview, so on a studio with a real
      // history you had to scroll past two lists to find out you could claim
      // it at all — the one thing this page exists to offer. It is now visible
      // before any scrolling, and stays reachable while reading the evidence
      // that answers "is this mine?".
      //
      // Not sticky once the form is open: a pinned block would cover the
      // fields it just revealed.
      stickyHeaderIndices={showForm ? undefined : [1]}
    >
      <View>
        <Text style={styles.h1}>{studio.name}</Text>
        {stats && (
          <Text style={styles.muted}>
            {stats.awards} award{stats.awards === 1 ? '' : 's'} · {stats.dancers} dancer
            {stats.dancers === 1 ? '' : 's'} · {stats.events} event{stats.events === 1 ? '' : 's'}
          </Text>
        )}
        {studio.bio ? <Text style={styles.bio}>{studio.bio}</Text> : null}
      </View>

      <View style={styles.stickyClaim}>
        {studio.is_mine ? (
          <Text style={styles.claimed}>You manage this studio.</Text>
        ) : studio.is_claimed ? (
          <>
            <Text style={styles.pitchTitle}>
              {studio.manager
                ? `${studio.manager.name} manages this studio`
                : 'This studio is already claimed'}
            </Text>
            <Text style={styles.pitchLine}>
              {/* Naming them is the whole point: "someone at the studio
                  manages it" leaves a family with no name to ask for. When
                  the manager did not agree to be named we say so plainly
                  rather than inventing a vaguer version of the same dead end. */}
              {studio.manager
                ? `${studio.manager.role ? `${studio.manager.role} · ` : ''}`
                  + (signedIn
                    ? 'Ask them to add you if you also need access.'
                    : 'If that’s you, sign in to pick up where you left off.')
                : (signedIn
                  ? 'Someone at the studio manages it, but they haven’t chosen to be named here. Contact us and we’ll put you in touch.'
                  : 'Its director manages it on AwardHome. If that’s you, sign in to pick up where you left off.')}
            </Text>
            {!signedIn && (
              <Pressable
                style={[styles.cta, styles.ctaTight]}
                onPress={() => router.push({ pathname: '/sign-in', params: { next: `/studio/${id}` } })}
                accessibilityRole="button"
              >
                <Text style={styles.ctaText}>Sign in</Text>
              </Pressable>
            )}
          </>
        ) : !showForm ? (
          <>
            <Text style={styles.pitchTitle}>Is this your studio?</Text>
            <Text style={styles.pitchLine}>
              Claiming it lets you confirm the awards families add for your dancers — until
              someone does, nobody at the studio sees them at all.
            </Text>
            <Pressable
              style={[styles.cta, styles.ctaTight]}
              onPress={() => (signedIn
                ? setShowForm(true)
                : router.push({ pathname: '/sign-in', params: { next: `/studio/${id}` } }))}
              accessibilityRole="button"
            >
              <Text style={styles.ctaText}>Claim this studio</Text>
            </Pressable>
          </>
        ) : (
          <>
            <Text style={styles.label}>Your name *</Text>
            <TextInput value={contactName} onChangeText={setContactName} style={styles.input} />
            {/* Consent at the point of collection. A name given as proof is
                not a name given as a public byline, so we ask here rather
                than quietly publishing what the form already had. */}
            <Pressable
              style={styles.checkRow}
              onPress={() => setShowPublicly(v => !v)}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: showPublicly }}
            >
              <Text style={styles.check}>{showPublicly ? '☑' : '☐'}</Text>
              <Text style={styles.checkLabel}>
                Show my name on the studio page, so families know who to ask for
              </Text>
            </Pressable>

            <Text style={styles.label}>Your role</Text>
            <TextInput value={role} onChangeText={setRole} style={styles.input}
              placeholder="Owner, director, office manager" placeholderTextColor={theme.muted} />

            <Text style={styles.label}>Studio address *</Text>
            <TextInput value={address} onChangeText={setAddress} style={styles.input} />
            <Text style={styles.hint}>
              This is how we tell studios with the same name apart — there are a lot of them.
            </Text>

            <Text style={styles.label}>A photo of you</Text>
            <Pressable
              style={styles.photoPick}
              onPress={() => {
                void (async () => {
                  try {
                    // Lazily required like every other native module here: a
                    // build without it degrades to no photo, not a dead screen.
                    // eslint-disable-next-line @typescript-eslint/no-var-requires
                    const ImagePicker = require('expo-image-picker') as typeof import('expo-image-picker');
                    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
                    if (!perm.granted) return;
                    const r = await ImagePicker.launchImageLibraryAsync({
                      mediaTypes: ['images'], quality: 0.7,
                    });
                    const a = r.canceled ? null : r.assets[0];
                    if (a) setPhoto({ uri: a.uri, ...(a.mimeType ? { mimeType: a.mimeType } : {}) });
                  } catch { /* no picker in this build */ }
                })();
              }}
              accessibilityRole="button"
            >
              <Text style={styles.photoPickText}>
                {photo ? '✓ Photo attached — tap to change' : 'Choose a photo'}
              </Text>
            </Pressable>
            <Text style={styles.hint}>
              Only the AwardHome team sees this. It helps us check you against your studio’s own
              website, which is the quickest way to get a claim approved — and it is why
              speculative claims rarely bother.
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
      </View>

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
  // Opaque on purpose: a sticky block with a transparent background lets the
  // list scroll visibly underneath it, which reads as a rendering fault.
  stickyClaim: {
    backgroundColor: theme.bg,
    paddingTop: theme.space(1), paddingBottom: theme.space(1.25),
    borderBottomColor: theme.border, borderBottomWidth: 1,
  },
  // A pinned bar has to stay short or it eats the page it is pinned over.
  pitchLine: { color: theme.muted, fontSize: 13, lineHeight: 18, marginTop: 2 },
  ctaTight: { marginTop: theme.space(1), padding: theme.space(1.25) },
  checkRow: {
    flexDirection: 'row', alignItems: 'flex-start',
    gap: theme.space(1), marginTop: theme.space(1),
  },
  check: { color: theme.gold, fontSize: 18, lineHeight: 22 },
  photoPick: {
    borderColor: theme.border, borderWidth: 1, borderStyle: 'dashed',
    borderRadius: theme.radius, padding: theme.space(1.5), alignItems: 'center',
  },
  photoPickText: { color: theme.gold, fontWeight: '600' },
  checkLabel: { color: theme.muted, fontSize: 13, lineHeight: 19, flex: 1 },
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
