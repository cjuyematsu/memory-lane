import { useEffect, useState } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Image } from 'expo-image';

import {
  FEED_BOTTOM_RESERVE,
  PhotoFrame,
  frameLayout,
} from '@/components/feed/photo-frame';
import { useWarmedEntryId } from '@/lib/feed-entry-warm';
import { hasFirstPainted, whenFirstPaint } from '@/lib/first-paint';

// Stop warming once the feed has painted (the warm is then redundant — the live
// card holds the same shared cache entry), or after this cap if it never paints
// (empty / stuck library), so a full-size decode can't linger in memory forever.
const WARM_CAP_MS = 15000;

// Root-mounted (app/_layout.tsx), renderless until the onboarding prewarm stashes
// the photo the Camera Roll will open on (lib/feed-entry-warm.ts). It then decodes
// that photo OFF-SCREEN at the feed's exact frame geometry — same PhotoFrame box +
// contentFit the live card uses — so the expo-image cache entry the card reads is
// already warm when the feed mounts after onboarding. The result: the entry card
// is a cache hit (instant) instead of the brief loading-polaroid beat on handoff.
// Inert on every normal launch (warmedEntryId is only set during onboarding) and
// can never affect the UI — it's off-screen and pointer-events-none, so worst case
// (a frame/size mismatch) it simply does nothing and the feed decodes as before.
export function FeedEntryWarmHost() {
  const warmedId = useWarmedEntryId();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [painted, setPainted] = useState(() => hasFirstPainted());

  useEffect(() => {
    if (painted) return;
    let active = true;
    whenFirstPaint(WARM_CAP_MS).then(() => {
      if (active) setPainted(true);
    });
    return () => {
      active = false;
    };
  }, [painted]);

  if (!warmedId || painted) return null;

  const frame = frameLayout(width, height, insets.top, insets.bottom, FEED_BOTTOM_RESERVE);
  return (
    // Off-screen but opaque and laid out at full size so expo-image actually
    // decodes it (opacity:0 / display:none would skip the work). Mirrors the
    // share card's off-screen warm approach.
    <View style={styles.offscreen} pointerEvents="none">
      <PhotoFrame top={frame.top} left={frame.left} width={frame.width} height={frame.height}>
        <Image
          source={{ uri: warmedId }}
          style={StyleSheet.absoluteFill}
          // The live card's first request is always contentFit="cover" (its
          // isLandscape flag starts false), so warm at cover to hit that exact
          // cache key regardless of the photo's orientation.
          contentFit="cover"
          cachePolicy="memory-disk"
          priority="high"
          transition={0}
        />
      </PhotoFrame>
    </View>
  );
}

const styles = StyleSheet.create({
  offscreen: {
    position: 'absolute',
    left: -10000,
    top: 0,
    width: 1,
    height: 1,
  },
});
