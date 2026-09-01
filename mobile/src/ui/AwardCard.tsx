import { useState } from 'react';
import {
  ActivityIndicator, Linking, Modal, Pressable, ScrollView, StyleSheet, Text, View,
} from 'react-native';
import { baseUrl, type Award } from '@/api/client';
import { theme } from './theme';

/**
 * The award card — the real one, rendered by the server.
 *
 * This deliberately does NOT reimplement the card in React Native. The card is
 * the product, not a layout: it is a container-query design measured in cqw so
 * it scales like an image, it carries per-org branding from
 * organizations.custom_icons as CSS custom properties, it has a flipbook back
 * stack (certificate, photo, thank-you notes, colophon), and it is the subject
 * of the provisional filing. A hand-built native copy would drift from all of
 * that inside one release, and every future card change would then need an App
 * Store review to reach anybody. Pointing a web view at
 * /dance/card/:dancer/:award means there is exactly one card, and the app picks
 * up card work the moment the server ships it.
 *
 * react-native-webview is required LAZILY, for the same reason expo-network and
 * expo-clipboard are (see src/outbox/index.ts): a build made before the
 * dependency existed throws "Cannot find native module", and a top-level import
 * would take the whole route down rather than one feature. Without it we show
 * an honest summary and a link out to the same card in the browser.
 */
function loadWebView(): React.ComponentType<Record<string, unknown>> | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('react-native-webview') as { WebView: React.ComponentType<Record<string, unknown>> };
    return mod.WebView ?? null;
  } catch {
    return null;
  }
}

export function AwardCardModal({
  award, dancerName, dancerUniqueId, onClose,
}: {
  award: Award | null;
  dancerName: string;
  dancerUniqueId: string;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const WebView = loadWebView();

  if (!award) return null;
  const cardUrl = `${baseUrl}/dance/card/${encodeURIComponent(dancerUniqueId)}/${award.id}`;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        {/* The backdrop closes; the card itself must not, or a tap meant to
            flip the card would dismiss it instead. */}
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />

        <View style={styles.sheet}>
          {WebView ? (
            <>
              <WebView
                source={{ uri: cardUrl }}
                style={styles.web}
                // The page paints its own background; a white flash between
                // load and paint reads as a broken card.
                backgroundColor="transparent"
                onLoadEnd={() => setLoading(false)}
                scrollEnabled={false}
                // A card is content, not an app surface: no navigation, no
                // arbitrary origins. Anything that is not our card page opens
                // in the real browser instead of inside the sheet.
                originWhitelist={[baseUrl]}
                onShouldStartLoadWithRequest={(req: { url: string }) => {
                  if (req.url.startsWith(cardUrl)) return true;
                  void Linking.openURL(req.url);
                  return false;
                }}
              />
              {loading && (
                <View style={styles.loading} pointerEvents="none">
                  <ActivityIndicator color={theme.gold} />
                </View>
              )}
            </>
          ) : (
            <AwardSummary award={award} dancerName={dancerName} cardUrl={cardUrl} />
          )}

          <Pressable style={styles.close} onPress={onClose} accessibilityRole="button">
            <Text style={styles.closeText}>Close</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

/**
 * Fallback for a binary built before react-native-webview existed. Honest
 * about what it is — a summary, with the real card one tap away — rather than
 * pretending to be the card.
 */
function AwardSummary({ award, dancerName, cardUrl }: {
  award: Award; dancerName: string; cardUrl: string;
}) {
  // Same rule as the list: no routine means no routine line, and which of
  // award_type/category holds the real name varies by organization, so show
  // both rather than picking one and hiding the other.
  const heading = award.performance_name
    || [award.category, award.award_type].filter(Boolean).join(' · ');
  const sub = award.performance_name
    ? [award.category, award.award_type].filter(Boolean).join(' · ')
    : '';

  return (
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
      {(award.dancer_count ?? 0) > 1 && (
        <Text style={styles.meta}>{award.dancer_count} dancers in this routine</Text>
      )}
      {award.verification_status === 'family_submitted' && (
        <Text style={styles.badge}>Added by a family · not yet confirmed</Text>
      )}

      <Pressable onPress={() => { void Linking.openURL(cardUrl); }} accessibilityRole="button">
        <Text style={styles.link}>Open the full award card ↗</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.8)',
    alignItems: 'center', justifyContent: 'center', padding: theme.space(2),
  },
  sheet: {
    width: '100%', maxWidth: 400, height: '78%',
    backgroundColor: '#141210', borderColor: theme.border, borderWidth: 1,
    borderRadius: 16, overflow: 'hidden',
  },
  web: { flex: 1, backgroundColor: 'transparent' },
  loading: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
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
  link: { color: theme.gold, fontWeight: '600', marginTop: theme.space(3), textAlign: 'center' },
  close: {
    borderTopColor: theme.border, borderTopWidth: 1,
    padding: theme.space(1.5), alignItems: 'center',
  },
  closeText: { color: theme.gold, fontWeight: '600' },
});
