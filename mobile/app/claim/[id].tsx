import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { claimDancer } from '@/api/client';
import { useSession } from '@/ui/Session';
import { theme } from '@/ui/theme';

/**
 * Claiming a dancer profile. Every claim is reviewed by a human — there is no
 * fast-track here the way there is for studios, because an email domain proves
 * nothing about a child.
 *
 * The studio claim code is optional and does NOT auto-approve: it proves
 * community membership, so it ROUTES the claim to the director who knows which
 * parent belongs to which dancer. The copy has to say that plainly, or a
 * family will read a code field as a password and wonder why it "failed".
 */
export default function ClaimScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { refresh } = useSession();
  const [relationship, setRelationship] = useState('');
  const [code, setCode] = useState('');
  const [proof, setProof] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{
    status: string; routedTo: string;
    unclaimedStudio: { id: number; unique_id: string; name: string } | null;
  } | null>(null);

  const submit = async () => {
    if (!id) return;
    setBusy(true); setError(null);
    try {
      const res = await claimDancer(id, {
        relationship: relationship.trim(),
        proof: proof.trim(),
        studio_code: code.trim() || undefined,
      });
      setDone({ status: res.status, routedTo: res.routedTo, unclaimedStudio: res.unclaimedStudio });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'We couldn’t file that claim.');
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <View style={styles.screen}>
        <Text style={styles.h1}>Claim sent</Text>
        <Text style={styles.muted}>
          {done.status === 'contested'
            // The honest version of an awkward situation: somebody else has
            // claimed this dancer too, and no studio gets to arbitrate that.
            ? 'Someone else has also claimed this dancer, so the AwardHome team will sort it out directly rather than asking a studio to choose. We’ll email you either way.'
            : done.routedTo === 'studio'
              ? 'Because you had your studio’s code, your studio director can confirm it directly. You’ll get an email when they do.'
              : 'The AwardHome team will review it and email you with the outcome.'}
        </Text>
        {/* Nobody at the studio will review this, because the studio has no
            owner. The family is the one person positioned to change that, and
            this is the moment they care most. */}
        {done.unclaimedStudio && (
          <View style={styles.invite}>
            <Text style={styles.inviteTitle}>{done.unclaimedStudio.name} hasn’t joined yet</Text>
            <Text style={styles.muted}>
              Your studio hasn’t claimed its page, so AwardHome reviews your claim instead of your
              own director — who would recognise you instantly. If you mention it to them, they can
              claim it from their phone in a minute.
            </Text>
            <Pressable
              style={styles.secondary}
              onPress={() => router.push({
                pathname: '/studio/[id]',
                params: { id: done.unclaimedStudio!.unique_id },
              })}
            >
              <Text style={styles.secondaryText}>Show them the studio page</Text>
            </Pressable>
          </View>
        )}

        <Pressable style={styles.cta} onPress={() => router.replace('/household')}>
          <Text style={styles.ctaText}>Back to my dancers</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <Text style={styles.muted}>
        Tell us who you are. A person reviews every claim on a dancer’s profile — we don’t
        approve these automatically.
      </Text>

      <Text style={styles.label}>Your relationship to the dancer</Text>
      <TextInput
        value={relationship}
        onChangeText={setRelationship}
        placeholder="Parent, guardian, or the dancer themselves"
        placeholderTextColor={theme.muted}
        style={styles.input}
        accessibilityLabel="Your relationship to the dancer"
      />

      <Text style={styles.label}>Studio claim code (optional)</Text>
      <TextInput
        value={code}
        onChangeText={setCode}
        placeholder="From your studio director"
        placeholderTextColor={theme.muted}
        autoCapitalize="characters"
        autoCorrect={false}
        style={styles.input}
        accessibilityLabel="Studio claim code, optional"
      />
      <Text style={styles.hint}>
        Not a password. If it matches your dancer’s studio, your own director confirms the claim
        instead of us — which is usually faster.
      </Text>

      <Text style={styles.label}>Anything else that helps us confirm</Text>
      <TextInput
        value={proof}
        onChangeText={setProof}
        placeholder="Optional"
        placeholderTextColor={theme.muted}
        multiline
        style={[styles.input, styles.multiline]}
        accessibilityLabel="Anything else that helps confirm the claim"
      />

      <Pressable style={styles.cta} onPress={submit} disabled={busy || relationship.trim().length === 0}>
        {busy ? <ActivityIndicator color={theme.gold} /> : <Text style={styles.ctaText}>Send claim</Text>}
      </Pressable>
      {error && <Text style={styles.error}>{error}</Text>}

      {/* Same-name dancers are common here, so tapping the wrong one is an
          ordinary mistake rather than an edge case — and a claim on the wrong
          child is exactly what the contested-claim machinery exists to clean
          up afterwards. Cheaper to make backing out obvious. */}
      <Pressable onPress={() => router.replace('/')} style={styles.escape}>
        <Text style={styles.link}>← Not the right dancer? Search again</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.bg, padding: theme.space(2.5) },
  h1: { color: theme.text, fontSize: 24, fontWeight: '700', marginBottom: theme.space(1) },
  label: { color: theme.text, marginTop: theme.space(2), marginBottom: theme.space(0.5), fontWeight: '600' },
  muted: { color: theme.muted, lineHeight: 20 },
  hint: { color: theme.muted, fontSize: 12, marginTop: theme.space(0.5), lineHeight: 17 },
  input: {
    backgroundColor: 'rgba(0,0,0,0.35)', borderColor: theme.border, borderWidth: 1,
    borderRadius: theme.radius, color: theme.text, padding: theme.space(1.5), fontSize: 16,
  },
  multiline: { minHeight: 80, textAlignVertical: 'top' },
  cta: {
    marginTop: theme.space(2.5), backgroundColor: theme.goldSoft, borderColor: theme.gold,
    borderWidth: 1, borderRadius: theme.radius, padding: theme.space(1.5), alignItems: 'center',
  },
  ctaText: { color: theme.gold, fontWeight: '600', fontSize: 16 },
  error: { color: theme.danger, marginTop: theme.space(2) },
  escape: { marginTop: theme.space(3), alignItems: 'center' },
  link: { color: theme.gold },
  invite: {
    marginTop: theme.space(2.5), padding: theme.space(1.5),
    backgroundColor: theme.goldSoft, borderRadius: theme.radius,
  },
  inviteTitle: { color: theme.gold, fontWeight: '700', fontSize: 16, marginBottom: theme.space(0.5) },
  secondary: {
    marginTop: theme.space(1.5), borderColor: theme.border, borderWidth: 1,
    borderRadius: theme.radius, padding: theme.space(1.25), alignItems: 'center',
  },
  secondaryText: { color: theme.text },
});
