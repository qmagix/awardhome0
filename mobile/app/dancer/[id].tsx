import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, Share, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { copyOrShare } from '@/ui/clipboard';
import { baseUrl, getTrophyCase, type Award, type MyClaim } from '@/api/client';
import { AwardCardModal } from '@/ui/AwardCard';
import { useSession } from '@/ui/Session';
import { theme } from '@/ui/theme';

/**
 * The trophy case — public, and the destination of the universal link from
 * awardhome.com/dancer/<unique_id>. A family tapping that link from a text
 * message lands here whether or not they have ever opened the app.
 */
/** The web's one-page studio apply: it creates the director's account and
 *  files the claim together, so there is nothing for them to set up first. */
function studioClaimUrl(uniqueId: string): string {
  return `${baseUrl}/claim/studio/${uniqueId}`;
}

export default function TrophyCaseScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { signedIn, dancers } = useSession();
  const [awards, setAwards] = useState<Award[]>([]);
  const [dancer, setDancer] =
    useState<{ id: number; unique_id: string; name: string; is_claimed: boolean } | null>(null);
  const [myClaim, setMyClaim] = useState<MyClaim | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [openCard, setOpenCard] = useState<Award | null>(null);
  const [unclaimedStudio, setUnclaimedStudio] =
    useState<{ id: number; unique_id: string; name: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (next?: string) => {
    if (!id) return;
    try {
      const res = await getTrophyCase(id, next);
      setDancer(res.dancer);
      setMyClaim(res.myClaim);
      setUnclaimedStudio(res.unclaimedStudio);
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
      {/* Already asked? Say where it stands. Offering the button again let a
          family file a second claim on their own child, which then read as two
          households in dispute and went to AwardHome as "contested". */}
      {myClaim && myClaim.status !== 'rejected' && !isMine ? (
        <View style={styles.pending}>
          <Text style={styles.pendingTitle}>
            {myClaim.status === 'contested'
              ? 'Someone else has claimed this dancer too'
              : `You've asked to manage ${dancer?.name}`}
          </Text>
          <Text style={styles.muted}>
            {myClaim.status === 'contested'
              ? 'The AwardHome team is sorting it out directly rather than asking a studio to choose between families. We\u2019ll email you.'
              : myClaim.studio_id
                ? 'Your studio director is confirming it — they know which families belong to which dancers. You\u2019ll get an email when they do.'
                : 'It\u2019s being reviewed. You\u2019ll get an email with the outcome.'}
          </Text>
          <Text style={styles.hint}>
            You don\u2019t have to wait to start: awards you add now are saved to your own list and
            sent automatically the moment your claim is approved. Nobody else can see them before
            then.
          </Text>
          <Pressable
            style={styles.secondary}
            onPress={() => router.push('/add')}
            accessibilityRole="button"
          >
            <Text style={styles.secondaryText}>Add an award while you wait</Text>
          </Pressable>

          {/* The honest version of "it's being reviewed": when the studio has
              no owner, nobody is reviewing it, and saying so is what makes the
              invite worth sending. The family is the only person here who can
              actually reach the director. */}
          {unclaimedStudio && (
            <View style={styles.invite}>
              <Text style={styles.muted}>
                {unclaimedStudio.name} hasn\u2019t claimed its studio page yet, so there\u2019s
                nobody there to confirm it. If you send your director this link, they can
                claim the studio and approve you — and confirm every other family\u2019s
                awards too.
              </Text>
              <Pressable
                style={styles.secondary}
                onPress={() => {
                  void Share.share({
                    message: `${unclaimedStudio.name} can claim its studio page on AwardHome `
                      + `here \u2014 then you can confirm our dancers\u2019 awards yourself: `
                      + `${studioClaimUrl(unclaimedStudio.unique_id)}`,
                    url: studioClaimUrl(unclaimedStudio.unique_id),
                  });
                }}
                accessibilityRole="button"
              >
                <Text style={styles.secondaryText}>Send your director the link</Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  void copyOrShare(studioClaimUrl(unclaimedStudio.unique_id))
                    .then((didCopy) => { if (didCopy) setCopied(true); });
                }}
                accessibilityRole="button"
              >
                <Text style={styles.copy}>
                  {copied ? 'Link copied' : 'Copy the link instead'}
                </Text>
              </Pressable>
            </View>
          )}
        </View>
      ) : dancer && !dancer.is_claimed && !isMine ? (
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
      ) : null}
      {isMine && <Text style={styles.mine}>You manage this profile.</Text>}

      {/* Sharing sends the public URL, not a rendered image. The web page
          carries OpenGraph tags so it unfurls properly in a message — and the
          link keeps working for someone who does not have the app. Evidence is
          never share media; only the public trophy case is shared. */}
      {dancer && (
        <Pressable
          style={styles.secondary}
          onPress={() => {
            const url = `${baseUrl}/dancer/${id}`;
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
        renderItem={({ item }) => {
          // 16% of awards carry no routine name — a convention honour or a
          // title has nothing to name. The old code printed the literal word
          // "Routine" there, which rendered a placeholder as if it were data.
          //
          // The replacement must NOT pick one of award_type/category and hide
          // the other, because which of them holds the real name varies by
          // organization and there is no ordering that is right everywhere:
          //
          //   JUMP    award_type "SCHOLARSHIP"              category "Senior JUMP VIP"
          //   NUVO    award_type "SCHOLARSHIP"              category "Teen BreakOut Artist"
          //   KAR     award_type "KAR Convention Scholarship"  category (empty)
          //   NYCDA   award_type "Outstanding Dancer"       category "Teen Outstanding Dancers"
          //
          // Preferring award_type labelled every JUMP and NUVO honour
          // "SCHOLARSHIP" and threw away the name of the award. So when there
          // is no routine, show BOTH — specific field first — and hide
          // nothing.
          const heading = item.performance_name
            || [item.category, item.award_type].filter(Boolean).join(' · ');
          const sub = item.performance_name
            ? [item.category, item.award_type].filter(Boolean).join(' · ')
            : '';
          return (
          <Pressable
            style={styles.card}
            onPress={() => setOpenCard(item)}
            accessibilityRole="button"
            accessibilityLabel={`Open the award card for ${heading ?? 'this award'}`}
          >
            {/* The card is the thing a family actually wants to look at and
                show people; the row is just the index into it. */}
            <Text style={styles.cardIcon}>🏅</Text>
            {/* place_display is formatted by the server from the same helper
                the web uses: "1" -> "1st", and an unplaced scholarship reads
                "Winner" rather than blank. */}
            <Text style={styles.place}>{item.place_display ?? item.place ?? ''}</Text>
            {heading ? <Text style={styles.routine}>{heading}</Text> : null}
            <Text style={styles.meta}>
              {[item.event_name, item.event_year, item.studio_name].filter(Boolean).join(' · ')}
            </Text>
            {sub.length > 0 && <Text style={styles.meta}>{sub}</Text>}
            {/* Honest labelling, exactly as the web renders it: an award added
                by a family and not yet corroborated says so. */}
            {item.verification_status === 'family_submitted' && (
              <Text style={styles.badge}>Added by a family · not yet confirmed</Text>
            )}
            {/* The row did not read as tappable — the medal alone was too
                quiet, and the card is the whole point of opening it. */}
            <Text style={styles.viewCard}>View award card ›</Text>
          </Pressable>
          );
        }}
      />

      <AwardCardModal
        award={openCard}
        dancerName={dancer?.name ?? ''}
        dancerUniqueId={dancer?.unique_id ?? String(id ?? '')}
        onClose={() => setOpenCard(null)}
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
  cardIcon: { position: 'absolute', right: theme.space(1.5), top: theme.space(1.5), fontSize: 18 },
  viewCard: { color: theme.gold, fontSize: 13, fontWeight: '600', marginTop: theme.space(1) },
  place: { color: theme.gold, fontWeight: '700', fontSize: 15 },
  routine: { color: theme.text, fontSize: 17, fontWeight: '600', marginTop: 2 },
  meta: { color: theme.muted, fontSize: 13, marginTop: 3 },
  badge: { color: theme.muted, fontSize: 12, marginTop: theme.space(1), fontStyle: 'italic' },
  secondary: {
    marginTop: theme.space(1.5), borderColor: theme.border, borderWidth: 1,
    borderRadius: theme.radius, padding: theme.space(1.25), alignItems: 'center',
  },
  secondaryText: { color: theme.text },
  invite: {
    marginTop: theme.space(1.5), paddingTop: theme.space(1.5),
    borderTopColor: theme.border, borderTopWidth: 1,
  },
  copy: { color: theme.gold, textAlign: 'center', marginTop: theme.space(1), fontSize: 14 },
  pending: {
    marginTop: theme.space(2), padding: theme.space(1.5),
    backgroundColor: theme.goldSoft, borderRadius: theme.radius,
  },
  pendingTitle: { color: theme.gold, fontWeight: '700', fontSize: 16, marginBottom: theme.space(0.5) },
  hint: { color: theme.muted, fontSize: 12, marginTop: theme.space(1), lineHeight: 17 },
});
