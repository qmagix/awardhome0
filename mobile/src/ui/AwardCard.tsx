import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { Award } from '@/api/client';
import { theme } from './theme';

/**
 * The award, shown as a card.
 *
 * A trophy case that reads like a database table gives a family nothing to be
 * proud of and nothing to show anyone. The card is the thing they actually
 * want — and, on the web, the thing the product is built around.
 *
 * Deliberately shows only what the record really holds: no placeholder words
 * where a field is empty, and the honest verification label when an award has
 * not been confirmed yet.
 */
export function AwardCardModal({
  award, dancerName, onClose,
}: {
  award: Award | null;
  dancerName: string;
  onClose: () => void;
}) {
  if (!award) return null;

  // Same rule as the list: a convention scholarship has no routine, and which
  // of award_type/category holds the real name varies by organization — so
  // show both rather than picking one and hiding the other.
  const heading = award.performance_name
    || [award.category, award.award_type].filter(Boolean).join(' · ');
  const sub = award.performance_name
    ? [award.category, award.award_type].filter(Boolean).join(' · ')
    : '';

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.card} onPress={(e) => e.stopPropagation()}>
          <ScrollView contentContainerStyle={styles.inner}>
            <Text style={styles.org}>{award.org_name ?? 'AwardHome'}</Text>

            <View style={styles.medallion}>
              <Text style={styles.place}>{award.place_display ?? award.place ?? '—'}</Text>
            </View>

            {heading ? <Text style={styles.routine}>{heading}</Text> : null}
            <Text style={styles.dancer}>{dancerName}</Text>
            {sub ? <Text style={styles.meta}>{sub}</Text> : null}

            <View style={styles.rule} />

            {award.event_name ? (
              <Text style={styles.meta}>
                {award.event_name}{award.event_year ? ` · ${award.event_year}` : ''}
              </Text>
            ) : null}
            {award.studio_name ? <Text style={styles.meta}>{award.studio_name}</Text> : null}
            {award.age_division ? <Text style={styles.meta}>{award.age_division}</Text> : null}
            {(award.dancer_count ?? 0) > 1 && (
              <Text style={styles.meta}>{award.dancer_count} dancers in this routine</Text>
            )}

            {award.verification_status === 'family_submitted' && (
              <Text style={styles.badge}>Added by a family · not yet confirmed</Text>
            )}
          </ScrollView>

          <Pressable style={styles.close} onPress={onClose} accessibilityRole="button">
            <Text style={styles.closeText}>Close</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.75)',
    alignItems: 'center', justifyContent: 'center', padding: theme.space(2.5),
  },
  card: {
    width: '100%', maxWidth: 380, maxHeight: '82%',
    backgroundColor: '#1a1712', borderColor: theme.gold, borderWidth: 1,
    borderRadius: 16, overflow: 'hidden',
  },
  inner: { padding: theme.space(3), alignItems: 'center' },
  org: {
    color: theme.muted, fontSize: 11, letterSpacing: 2,
    textTransform: 'uppercase', textAlign: 'center',
  },
  medallion: {
    marginTop: theme.space(2), marginBottom: theme.space(2),
    minWidth: 116, paddingHorizontal: theme.space(2), paddingVertical: theme.space(1.5),
    borderRadius: 999, borderColor: theme.gold, borderWidth: 2,
    backgroundColor: theme.goldSoft, alignItems: 'center',
  },
  place: { color: theme.gold, fontSize: 20, fontWeight: '800', textAlign: 'center' },
  routine: { color: theme.text, fontSize: 21, fontWeight: '700', textAlign: 'center' },
  dancer: {
    color: theme.gold, fontSize: 15, fontWeight: '600',
    marginTop: theme.space(0.75), textAlign: 'center',
  },
  meta: { color: theme.muted, fontSize: 13, marginTop: 4, textAlign: 'center', lineHeight: 19 },
  rule: {
    height: 1, alignSelf: 'stretch', backgroundColor: theme.border,
    marginVertical: theme.space(2),
  },
  badge: {
    color: theme.muted, fontSize: 12, fontStyle: 'italic',
    marginTop: theme.space(2), textAlign: 'center',
  },
  close: {
    borderTopColor: theme.border, borderTopWidth: 1,
    padding: theme.space(1.5), alignItems: 'center',
  },
  closeText: { color: theme.gold, fontWeight: '600' },
});
