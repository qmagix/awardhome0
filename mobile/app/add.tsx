import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, Alert, FlatList, Pressable, ScrollView, StyleSheet, Switch, Text,
  TextInput, View,
} from 'react-native';
import { router } from 'expo-router';
import {
  findEvents, openEventSession, requestIndependentPublish,
  type EventOption, type EventSession,
} from '@/api/client';
import { outbox, flushIfPossible } from '@/outbox';
import { kvGet, kvSet } from '@/outbox/store';
import { useSession } from '@/ui/Session';
import { theme } from '@/ui/theme';

const SESSION_KEY = 'active_event_session';
const GROUP_SIZES = [
  { key: 'solo', label: 'Solo', enumerable: true },
  { key: 'duet', label: 'Duet', enumerable: true },
  { key: 'trio', label: 'Trio', enumerable: true },
  { key: 'small_group', label: 'Small Group', enumerable: false },
  { key: 'large_group', label: 'Large Group', enumerable: false },
  { key: 'line', label: 'Line', enumerable: false },
  { key: 'grand_line', label: 'Grand Line', enumerable: false },
  { key: 'production', label: 'Production', enumerable: false },
] as const;

interface StoredSession { session: EventSession; label: string }

/**
 * The Add flow: dancer → event → routine → group size → placement →
 * teacher/choreographer → evidence → confirm.
 *
 * THE ONE THING THAT NEEDS SIGNAL is choosing the event, and it happens once
 * per weekend. After that the session is on disk and every award is queued
 * locally, so the rest of a competition can be entered in a basement with no
 * bars. That split is deliberate (design §6.7): an event has to be resolved
 * against the archive or it becomes a duplicate, but a placement does not.
 */
export default function AddAwardScreen() {
  const { dancers, signedIn, ready } = useSession();
  const [askedPublish, setAskedPublish] = useState(false);
  const [stored, setStored] = useState<StoredSession | null>(null);
  const [loadingSession, setLoadingSession] = useState(true);

  // Event picking (only while there is no session)
  const [query, setQuery] = useState('');
  const [options, setOptions] = useState<EventOption[]>([]);
  const [searching, setSearching] = useState(false);

  // The award itself
  const [dancerId, setDancerId] = useState<number | null>(null);
  // The dancer this entry is for, resolved once — several blocks below need it.
  const selected = dancers.find(d => d.id === dancerId) ?? null;
  const [routine, setRoutine] = useState('');
  const [groupSize, setGroupSize] = useState('');
  const [place, setPlace] = useState('');
  const [category, setCategory] = useState('');
  const [teacher, setTeacher] = useState('');
  const [choreographer, setChoreographer] = useState('');
  const [note, setNote] = useState('');
  const [castComplete, setCastComplete] = useState(false);
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void (async () => {
      setStored(await kvGet<StoredSession>(SESSION_KEY));
      setLoadingSession(false);
    })();
  }, []);

  useEffect(() => {
    if (ready && !signedIn) router.replace('/sign-in');
    if (dancers.length === 1 && dancerId === null) setDancerId(dancers[0]!.id);
  }, [ready, signedIn, dancers, dancerId]);

  const search = useCallback(async (q: string) => {
    if (q.trim().length < 2) { setOptions([]); return; }
    setSearching(true);
    try {
      setOptions((await findEvents({ q: q.trim() })).options);
    } catch {
      Alert.alert(
        'Need a connection',
        'Choosing the competition needs signal — it has to be matched against the archive so your awards don\'t create a duplicate event. Once it\'s chosen you can add the rest of the weekend offline.',
      );
    } finally {
      setSearching(false);
    }
  }, []);

  const chooseEvent = useCallback(async (opt: EventOption) => {
    try {
      const ref = opt.kind === 'event' ? { event_id: opt.id }
        : opt.kind === 'candidate' ? { event_candidate_id: opt.id }
          : { event_id: undefined };
      if (opt.kind === 'upcoming') {
        // An organizer's announced stop has no canonical event yet; the server
        // seeds a candidate for it at submit time, so the session hangs off
        // the submission rather than being opened here.
        const s: StoredSession = {
          session: { id: '', event_id: null, event_candidate_id: null, created_at: '' },
          label: opt.name ?? 'This competition',
        };
        await kvSet(SESSION_KEY, { ...s, upcoming_event_id: opt.id });
        setStored(s);
        return;
      }
      const res = await openEventSession(ref);
      const next: StoredSession = { session: res.session, label: opt.name ?? 'This competition' };
      await kvSet(SESSION_KEY, next);
      setStored(next);
    } catch {
      Alert.alert('Could not start', 'We couldn\'t reach AwardHome to set up this event.');
    }
  }, []);

  // expo-image-picker is loaded only when the button is tapped. A top-level
  // import throws "Cannot find native module 'ExponentImagePicker'" on a
  // binary built before the dependency was added, and that failure took the
  // whole SCREEN down — a photo is optional, so its module must be too.
  const attachPhoto = useCallback(async () => {
    let ImagePicker: typeof import('expo-image-picker');
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      ImagePicker = require('expo-image-picker') as typeof import('expo-image-picker');
    } catch {
      Alert.alert(
        'Photos need a newer build',
        'This build of the app does not include the photo picker yet. You can add the award now and attach a photo later.',
      );
      return;
    }
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Photos not allowed', 'You can add a photo later from the trophy case.');
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8 });
    if (!res.canceled && res.assets[0]) setPhotoUri(res.assets[0].uri);
  }, []);

  const size = GROUP_SIZES.find(g => g.key === groupSize);

  const save = useCallback(async () => {
    if (!dancerId || !routine.trim() || !groupSize) return;
    setSaving(true);
    try {
      const active = await kvGet<StoredSession & { upcoming_event_id?: number }>(SESSION_KEY);
      await outbox.enqueue({
        dancer_id: dancerId,
        event_id: active?.session?.event_id ?? undefined,
        event_candidate_id: active?.session?.event_candidate_id ?? undefined,
        upcoming_event_id: active?.upcoming_event_id,
        event_session_id: active?.session?.id || undefined,
        performance_name: routine.trim(),
        group_size: groupSize,
        place: place.trim() || undefined,
        category: category.trim() || undefined,
        teacher: teacher.trim() || undefined,
        choreographer: choreographer.trim() || undefined,
        notes: note.trim() || undefined,
        // Only the enumerable formats may claim a complete cast; the server
        // enforces this too, so a client bug cannot turn a group into a solo.
        cast_complete: size?.enumerable ? castComplete : false,
      });
      // Fire-and-forget: queued is saved. Whether it reaches the server now or
      // in the car park is not the family's problem.
      void flushIfPossible();

      // Keep the weekend's context; clear only what changes per routine.
      setRoutine(''); setPlace(''); setCategory(''); setNote('');
      setCastComplete(false); setPhotoUri(null);
      Alert.alert('Saved', 'Added to your queue. It will send itself when you have signal.');
    } finally {
      setSaving(false);
    }
  }, [dancerId, routine, groupSize, place, category, teacher, choreographer, note, castComplete, size]);

  if (loadingSession) {
    return <View style={styles.screen}><ActivityIndicator color={theme.gold} /></View>;
  }

  // ---- Step 0: which competition ----
  if (!stored) {
    return (
      <View style={styles.screen}>
        <Text style={styles.h1}>Which competition?</Text>
        <Text style={styles.muted}>
          Pick it once and the whole weekend goes under it — you won&apos;t be asked again, and
          everything after this works without signal.
        </Text>
        <TextInput
          value={query}
          onChangeText={(t) => { setQuery(t); void search(t); }}
          placeholder="Search competitions"
          placeholderTextColor={theme.muted}
          style={styles.input}
        />
        {searching && <ActivityIndicator color={theme.gold} style={{ marginTop: theme.space(1) }} />}
        <FlatList
          data={options}
          keyExtractor={(o) => `${o.kind}:${o.id}`}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => (
            <Pressable style={styles.row} onPress={() => void chooseEvent(item)}>
              <Text style={styles.rowName}>{item.name}</Text>
              <Text style={styles.rowMeta}>
                {[item.when, item.where, item.note].filter(Boolean).join(' · ')}
              </Text>
            </Pressable>
          )}
        />
      </View>
    );
  }

  // ---- Steps 1–8: the award ----
  return (
    <ScrollView style={styles.screen} contentContainerStyle={{ paddingBottom: theme.space(6) }}>
      <View style={styles.sessionBar}>
        <Text style={styles.sessionText}>{stored.label}</Text>
        <Pressable onPress={() => { void kvSet(SESSION_KEY, null); setStored(null); }}>
          <Text style={styles.link}>Change</Text>
        </Pressable>
      </View>

      <Text style={styles.label}>Dancer</Text>
      <View style={styles.chips}>
        {dancers.map(d => (
          <Pressable
            key={d.id}
            onPress={() => setDancerId(d.id)}
            style={[styles.chip, dancerId === d.id && styles.chipOn]}
          >
            <Text style={dancerId === d.id ? styles.chipTextOn : styles.chipText}>
              {d.name}{d.standing === 'pending_claim' ? ' · pending' : ''}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* An independent has no director, so "pending review" would name a
          reviewer who does not exist. Say what is true: it is kept, privately,
          and there are two honest ways out — another family recording the same
          result, or AwardHome reviewing the record once. */}
      {selected?.standing === 'owner'
        && selected.studios.some(st => st.is_independent)
        && selected.independent_publish_status !== 'approved' && (
        <View style={styles.privateNote}>
          <Text style={styles.hint}>
            {selected.name} dances independently, so there is no studio director to confirm awards.
            What you add is kept privately for you until another family records the same result — or
            until AwardHome reviews the record. Keep going: nothing is lost by entering it now.
          </Text>
          {selected.independent_publish_status === 'requested' ? (
            <Text style={styles.hint}>✓ You&rsquo;ve asked AwardHome to review this record.</Text>
          ) : (
            <Pressable
              onPress={() => {
                void requestIndependentPublish(selected.id)
                  .then(() => setAskedPublish(true))
                  .catch(() => setAskedPublish(false));
              }}
              accessibilityRole="button"
            >
              <Text style={styles.askLink}>
                {askedPublish ? 'Asked — we\u2019ll email you' : 'Ask AwardHome to publish this record'}
              </Text>
            </Pressable>
          )}
        </View>
      )}

      {/* Say what will actually happen. Recording a weekend you remember is
          worth doing now; pretending it was submitted when it is waiting on a
          claim is how families conclude their entries vanished. */}
      {dancerId !== null
        && dancers.find(d => d.id === dancerId)?.standing === 'pending_claim' && (
        <Text style={styles.hint}>
          Your claim on this dancer is still being confirmed, so awards you add are saved to your
          own list and sent automatically once it is approved. Nobody else can see them before
          then — nothing is lost by writing the weekend down now.
        </Text>
      )}
      {/* The studio is never asked for — it comes from the dancer's
          affiliation, which is what keeps duplicates out of the archive. */}
      {dancerId !== null && (
        <Text style={styles.hint}>
          Studio: {selected?.studios
            .map(s => (s.is_independent ? 'Independent' : s.name)).join(', ') || 'none on file'}
        </Text>
      )}

      <Text style={styles.label}>Routine name *</Text>
      <TextInput value={routine} onChangeText={setRoutine} style={styles.input}
        placeholder="e.g. Fireworks" placeholderTextColor={theme.muted} />

      <Text style={styles.label}>Routine size *</Text>
      <View style={styles.chips}>
        {GROUP_SIZES.map(g => (
          <Pressable
            key={g.key}
            onPress={() => setGroupSize(g.key)}
            style={[styles.chip, groupSize === g.key && styles.chipOn]}
          >
            <Text style={groupSize === g.key ? styles.chipTextOn : styles.chipText}>{g.label}</Text>
          </Pressable>
        ))}
      </View>
      {size && !size.enumerable && (
        <Text style={styles.hint}>
          Just your own dancer. Other families add themselves — the cast fills in over the season
          without anyone typing eight names.
        </Text>
      )}
      {size?.enumerable && (
        <View style={styles.switchRow}>
          <Switch value={castComplete} onValueChange={setCastComplete}
            trackColor={{ true: theme.gold, false: theme.border }} />
          <Text style={styles.hint}>That&apos;s everyone in this routine</Text>
        </View>
      )}

      <Text style={styles.label}>Placement</Text>
      <TextInput value={place} onChangeText={setPlace} style={styles.input}
        placeholder="e.g. 1st" placeholderTextColor={theme.muted} />

      <Text style={styles.label}>Category</Text>
      <TextInput value={category} onChangeText={setCategory} style={styles.input}
        placeholder="e.g. Teen Contemporary" placeholderTextColor={theme.muted} />

      <Text style={styles.label}>Teacher</Text>
      <TextInput value={teacher} onChangeText={setTeacher} style={styles.input} />
      <Text style={styles.label}>Choreographer</Text>
      <TextInput value={choreographer} onChangeText={setChoreographer} style={styles.input} />
      <Text style={styles.hint}>
        Competitions almost never publish these. You may be the only person who can record who made
        the routine.
      </Text>

      <Text style={styles.label}>Photo (optional)</Text>
      <Pressable style={styles.secondary} onPress={() => void attachPhoto()}>
        <Text style={styles.secondaryText}>{photoUri ? 'Photo attached — change' : 'Add a photo'}</Text>
      </Pressable>
      <Text style={styles.hint}>
        Uploaded once you have signal, and reviewed before it appears anywhere.
      </Text>

      <Text style={styles.label}>Anything a reviewer should know?</Text>
      <TextInput value={note} onChangeText={setNote} style={[styles.input, styles.multiline]} multiline />

      <Pressable
        style={[styles.cta, (!dancerId || !routine.trim() || !groupSize) && styles.ctaOff]}
        onPress={() => void save()}
        disabled={saving || !dancerId || !routine.trim() || !groupSize}
      >
        {saving ? <ActivityIndicator color={theme.gold} />
          : <Text style={styles.ctaText}>Add to queue</Text>}
      </Pressable>
      <Pressable onPress={() => router.push('/outbox')}>
        <Text style={[styles.link, { textAlign: 'center', marginTop: theme.space(2) }]}>
          See what&apos;s waiting to send →
        </Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.bg, padding: theme.space(2) },
  h1: { color: theme.text, fontSize: 22, fontWeight: '700' },
  label: { color: theme.text, fontWeight: '600', marginTop: theme.space(2), marginBottom: theme.space(0.5) },
  muted: { color: theme.muted, lineHeight: 20, marginTop: theme.space(1) },
  privateNote: {
    marginTop: theme.space(1.5), padding: theme.space(1.5),
    backgroundColor: 'rgba(212,175,55,0.08)',
    borderColor: theme.border, borderWidth: 1, borderRadius: theme.radius,
  },
  askLink: { color: theme.gold, marginTop: theme.space(1), fontWeight: '600' },
  hint: { color: theme.muted, fontSize: 12, marginTop: theme.space(0.5), lineHeight: 17 },
  input: {
    backgroundColor: 'rgba(0,0,0,0.35)', borderColor: theme.border, borderWidth: 1,
    borderRadius: theme.radius, color: theme.text, padding: theme.space(1.5), fontSize: 16,
  },
  multiline: { minHeight: 70, textAlignVertical: 'top' },
  row: { borderBottomColor: theme.border, borderBottomWidth: 1, paddingVertical: theme.space(1.5) },
  rowName: { color: theme.text, fontSize: 16, fontWeight: '600' },
  rowMeta: { color: theme.muted, fontSize: 13, marginTop: 2 },
  sessionBar: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: theme.goldSoft, borderRadius: theme.radius, padding: theme.space(1.25),
  },
  sessionText: { color: theme.gold, fontWeight: '600', flexShrink: 1 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.space(1) },
  chip: {
    borderColor: theme.border, borderWidth: 1, borderRadius: 999,
    paddingVertical: theme.space(0.75), paddingHorizontal: theme.space(1.5),
  },
  chipOn: { borderColor: theme.gold, backgroundColor: theme.goldSoft },
  chipText: { color: theme.muted },
  chipTextOn: { color: theme.gold, fontWeight: '600' },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: theme.space(1), marginTop: theme.space(1) },
  secondary: {
    borderColor: theme.border, borderWidth: 1, borderRadius: theme.radius,
    padding: theme.space(1.25), alignItems: 'center',
  },
  secondaryText: { color: theme.text },
  cta: {
    marginTop: theme.space(3), backgroundColor: theme.goldSoft, borderColor: theme.gold,
    borderWidth: 1, borderRadius: theme.radius, padding: theme.space(1.5), alignItems: 'center',
  },
  ctaOff: { opacity: 0.4 },
  ctaText: { color: theme.gold, fontWeight: '600', fontSize: 16 },
  link: { color: theme.gold },
});
