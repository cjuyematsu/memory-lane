import { StyleSheet, Text, View } from 'react-native';

import BellIcon from '@/assets/icons/bell.svg';
import {
  Colors,
  DisplayFont,
  Ink,
  Letterbox,
  Paper,
  PhotoRatio,
} from '@/constants/theme';

// Static, data-free previews of each feature, shown above the copy on the
// matching onboarding step so people see the real thing before granting the
// permission it needs. The styling mirrors the live components (feed-card.tsx,
// grid.tsx, memory-banner.tsx) but holds no photos/location, since onboarding
// runs before any permission is granted.

const PLACEHOLDER = Colors.light.backgroundSelected; // #E0E1E6, a framed "photo"

/** The Camera Roll card: a 3:4 letterboxed frame + the date/place caption,
 *  matching components/feed/feed-card.tsx. */
export function MockFeedCard({ width = 188 }: { width?: number }) {
  return (
    <View style={styles.feedWrap}>
      <View style={[styles.frame, { width, height: width / PhotoRatio }]}>
        <View style={styles.photo} />
      </View>
      <Text style={styles.date}>2 YEARS AGO</Text>
      <Text style={styles.place}>LISBON, PORTUGAL</Text>
    </View>
  );
}

/** The Near Me grid: a small block of tiles, matching components/near-me/grid.tsx. */
export function MockGrid({ width = 240 }: { width?: number }) {
  const gap = 4;
  const tile = (width - gap * 2) / 3;
  // A gentle checker of two grays so the grid reads as distinct photos, not one
  // flat panel.
  const shades = [
    PLACEHOLDER,
    Colors.light.backgroundElement,
    PLACEHOLDER,
    Colors.light.backgroundElement,
    PLACEHOLDER,
    Colors.light.backgroundElement,
    Colors.light.backgroundElement,
    PLACEHOLDER,
    Colors.light.backgroundElement,
  ];
  return (
    <View style={[styles.grid, { width, gap }]}>
      {shades.map((bg, i) => (
        <View key={i} style={{ width: tile, height: tile, borderRadius: 4, backgroundColor: bg }} />
      ))}
    </View>
  );
}

/** The memory notification banner, matching components/notifications/memory-banner.tsx. */
export function MockBanner({ width = 300 }: { width?: number }) {
  return (
    <View style={[styles.bannerCard, { width }]}>
      <View style={styles.bannerIcon}>
        <BellIcon width={13} height={13} fill={Paper} />
      </View>
      <View style={styles.bannerText}>
        <Text style={styles.bannerTitle}>MEMORY NEARBY</Text>
        <Text style={styles.bannerSub}>Tap to see 6 photos from here</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  feedWrap: {
    alignItems: 'center',
  },
  frame: {
    borderWidth: 10,
    borderColor: Letterbox,
    backgroundColor: Letterbox,
    overflow: 'hidden',
  },
  photo: {
    flex: 1,
    backgroundColor: PLACEHOLDER,
  },
  date: {
    fontFamily: DisplayFont,
    fontSize: 22,
    color: Ink,
    textTransform: 'uppercase',
    textAlign: 'center',
    marginTop: 18,
  },
  place: {
    fontFamily: DisplayFont,
    fontSize: 10,
    lineHeight: 15,
    color: Ink,
    textTransform: 'uppercase',
    textAlign: 'center',
    letterSpacing: 0.5,
    marginTop: 8,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  // Same gallery card as the live banner: white paper, Ink hairline, soft shadow.
  bannerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 16,
    backgroundColor: Paper,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(17,17,17,0.10)',
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  bannerIcon: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Ink,
  },
  bannerText: {
    flex: 1,
  },
  bannerTitle: {
    fontFamily: DisplayFont,
    color: Ink,
    fontSize: 13,
    textTransform: 'uppercase',
  },
  bannerSub: {
    color: Colors.light.textSecondary,
    fontSize: 12,
    marginTop: 2,
  },
});
