import { useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';

import { type SharedRefType } from 'expo';
import { Image, type ImageLoadEventData } from 'expo-image';

import { DisplayFont, Ink, Letterbox, Paper, PhotoRatio } from '@/constants/theme';
import { getAssetRatio, setAssetRatio } from '@/lib/asset-ratio-cache';
import { computeThenNowInset, type ThenNowPrimary } from '@/lib/share-memory';
import { formatDistanceShort } from '@/utils/distance';
import { formatTimeAgo } from '@/utils/time-ago';

// Space under the frame for the date line plus the distance sub-line.
const CAPTION_BLOCK = 52;
const FRAME_RADIUS = 18;

// The BeReal-style then/now: one big rounded PhotoRatio frame with the other
// photo as a small white-bordered inset in the top-left corner. Shared by the
// review screen (dark) and the gallery viewer (light). Controlled: the parent
// owns `primary` (which photo is big) and gets `onSwap` when the inset is
// tapped — whatever arrangement is showing is what the parent shares/saves.
// Sizes itself to whatever box it's given via onLayout.
//
// The "then" side renders the library asset by id (ph:// / content://, the
// iCloud-safe way); if the original was deleted the load errors: as the big
// photo it degrades to a labeled panel, as the inset it quietly disappears.
export function ThenNowPreview({
  thenUri,
  nowSource,
  thenCreationTime,
  distanceM = null,
  primary,
  onSwap,
  showInset = true,
  tone = 'dark',
  settleFrom = null,
}: {
  thenUri: string;
  // Fresh captures hand the native image ref (renders instantly, no file
  // round-trip); the gallery viewer passes the persisted file uri.
  nowSource: string | SharedRefType<'image'>;
  thenCreationTime: number | null;
  // How far from the original spot the retake was captured, when known.
  distanceM?: number | null;
  primary: ThenNowPrimary;
  onSwap?: () => void;
  // false = "today only" mode: just the new photo, no inset.
  showInset?: boolean;
  // Caption color context: 'dark' = white text (review), 'light' = ink (viewer).
  tone?: 'light' | 'dark';
  // Shared-element settle: a window-coordinate rect the photo frame should
  // visually START at (the camera preview box), shrinking into its layout
  // position on mount. The review passes the camera's frameLayout rect so a
  // fresh capture reads as the frozen shot settling into the review card
  // instead of cutting between two sizes. null (the default) renders
  // statically.
  settleFrom?: { top: number; left: number; width: number; height: number } | null;
}) {
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  // Keyed by uri so a reused element can't carry a failure across items.
  const [thenFailedFor, setThenFailedFor] = useState<string | null>(null);
  const thenFailed = thenFailedFor === thenUri;
  // Keyed like the failure state. Fresh captures open with the "then" photo
  // as the inset, and its ph:// load lands a beat after mount — rendering the
  // white-bordered box before the photo made the review visibly assemble in
  // pieces. The inset stays invisible until the then-image has real pixels;
  // once loaded it stays visible across primary swaps (both images are
  // decoded by then, so swaps never re-blank).
  const [thenLoadedFor, setThenLoadedFor] = useState<string | null>(null);
  const thenLoaded = thenLoadedFor === thenUri;

  // Same cover/contain rule as everywhere for the old photo when it's the big
  // one (an inset is always cover): seeded from the shared ratio cache,
  // corrected on load.
  const cachedRatio = getAssetRatio(thenUri);
  const [loadedLandscape, setLoadedLandscape] = useState(false);
  const thenLandscape = loadedLandscape || (cachedRatio !== undefined && cachedRatio > 1);

  let frameW = 0;
  let frameH = 0;
  if (box) {
    frameH = Math.max(0, box.h - CAPTION_BLOCK);
    frameW = frameH * PhotoRatio;
    if (frameW > box.w) {
      frameW = box.w;
      frameH = frameW / PhotoRatio;
    }
  }
  const inset = frameW > 0 ? computeThenNowInset(frameW, PhotoRatio) : null;

  // The settle: once the frame has a real window position, jump it to the
  // camera rect (center-anchored scale keeps the math exact: translate by the
  // center delta, scale by the width ratio) and ease home. The frame stays
  // invisible for the one frame before measurement so it can't flash at its
  // final position first; the caption fades in on the settle's tail so the
  // big frame never slides over already-visible text. All no-ops when
  // `settleFrom` is null.
  const settleDone = useRef(false);
  const settle = useSharedValue(settleFrom ? 0 : 1);
  const settleReady = useSharedValue(settleFrom ? 0 : 1);
  const settleDx = useSharedValue(0);
  const settleDy = useSharedValue(0);
  const settleScale = useSharedValue(1);
  const frameRef = useRef<View>(null);
  const onFrameLayout = () => {
    if (!settleFrom || settleDone.current) return;
    frameRef.current?.measureInWindow((x, y, w, h) => {
      if (settleDone.current || !w || !h) return;
      settleDone.current = true;
      settleDx.value = settleFrom.left + settleFrom.width / 2 - (x + w / 2);
      settleDy.value = settleFrom.top + settleFrom.height / 2 - (y + h / 2);
      settleScale.value = settleFrom.width / w;
      settleReady.value = 1;
      // Small delay: the host crossfades the review in over the frozen
      // capture (~200ms); holding at the camera rect until that blend is
      // mostly done means the fade is invisible (identical pixels on
      // identical rects) and the settle then moves a fully-opaque frame.
      settle.value = withDelay(
        120,
        withTiming(1, {
          duration: 420,
          easing: Easing.out(Easing.cubic),
        })
      );
    });
  };
  const frameSettleStyle = useAnimatedStyle(() => ({
    opacity: settleReady.value,
    transform: [
      { translateX: settleDx.value * (1 - settle.value) },
      { translateY: settleDy.value * (1 - settle.value) },
      { scale: settleScale.value + (1 - settleScale.value) * settle.value },
    ],
  }));
  const captionSettleStyle = useAnimatedStyle(() => ({
    opacity: interpolate(settle.value, [0.55, 1], [0, 1], 'clamp'),
  }));

  const bigIsThen = showInset && primary === 'then';
  // expo-image takes either a {uri} source or a SharedRefType<'image'> directly.
  const asSource = (s: string | SharedRefType<'image'>) =>
    typeof s === 'string' ? { uri: s } : s;
  const bigSource = asSource(bigIsThen ? thenUri : nowSource);
  const insetSource = asSource(bigIsThen ? nowSource : thenUri);
  const insetIsThen = !bigIsThen;

  const onThenLoad = (e: ImageLoadEventData) => {
    setThenLoadedFor(thenUri);
    const { width: w, height: h } = e.source ?? {};
    if (w && h) {
      setAssetRatio(thenUri, w / h);
      if (w > h) setLoadedLandscape(true);
    }
  };
  const onThenError = () => setThenFailedFor(thenUri);

  return (
    <View
      style={styles.root}
      onLayout={(e) =>
        setBox({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })
      }>
      {box && frameW > 0 && inset ? (
        <>
          <Animated.View
            ref={frameRef}
            onLayout={onFrameLayout}
            style={[styles.frame, { width: frameW, height: frameH }, frameSettleStyle]}>
            {bigIsThen && thenFailed ? (
              <View style={styles.missing}>
                <Text style={styles.missingLabel}>
                  Original photo is no longer in your library
                </Text>
              </View>
            ) : (
              <Image
                source={bigSource}
                style={StyleSheet.absoluteFill}
                contentFit={bigIsThen && thenLandscape ? 'contain' : 'cover'}
                cachePolicy="memory-disk"
                transition={120}
                onLoad={bigIsThen ? onThenLoad : undefined}
                onError={bigIsThen ? onThenError : undefined}
              />
            )}

            {showInset && !(insetIsThen && thenFailed) ? (
              <Pressable
                onPress={onSwap}
                disabled={!onSwap}
                style={[
                  styles.inset,
                  {
                    left: inset.margin,
                    top: inset.margin,
                    width: inset.width,
                    height: inset.height,
                    borderWidth: inset.border,
                    borderRadius: inset.radius,
                    // Invisible until the then-photo has pixels (see above);
                    // a now-ref inset renders instantly and never hides.
                    opacity: insetIsThen && !thenLoaded ? 0 : 1,
                  },
                ]}>
                <Image
                  source={insetSource}
                  style={StyleSheet.absoluteFill}
                  contentFit="cover"
                  cachePolicy="memory-disk"
                  transition={120}
                  onLoad={insetIsThen ? onThenLoad : undefined}
                  onError={insetIsThen ? onThenError : undefined}
                />
                {/* One-word disambiguation on the small panel only; the big
                    photo's identity is implied by the caption/chip. */}
                <View style={styles.insetTag} pointerEvents="none">
                  <Text style={styles.insetTagLabel}>
                    {insetIsThen ? 'Then' : 'Now'}
                  </Text>
                </View>
              </Pressable>
            ) : null}
          </Animated.View>
          <Animated.View style={[styles.captionBlock, captionSettleStyle]}>
            <Text style={[styles.caption, tone === 'light' ? styles.captionLight : null]}>
              {formatTimeAgo(thenCreationTime)}
            </Text>
            {formatDistanceShort(distanceM) ? (
              <Text style={[styles.sub, tone === 'light' ? styles.captionLight : null]}>
                {formatDistanceShort(distanceM)}
              </Text>
            ) : null}
          </Animated.View>
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  frame: {
    borderRadius: FRAME_RADIUS,
    overflow: 'hidden',
    backgroundColor: Letterbox,
  },
  inset: {
    position: 'absolute',
    borderColor: Paper,
    overflow: 'hidden',
    backgroundColor: Letterbox,
  },
  insetTag: {
    position: 'absolute',
    bottom: 5,
    alignSelf: 'center',
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 8,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  insetTagLabel: {
    fontFamily: DisplayFont,
    color: Paper,
    fontSize: 9,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  captionBlock: {
    marginTop: 12,
    height: CAPTION_BLOCK - 12,
    alignItems: 'center',
    gap: 3,
  },
  caption: {
    fontFamily: DisplayFont,
    color: Paper,
    fontSize: 13,
    textTransform: 'uppercase',
  },
  sub: {
    fontFamily: DisplayFont,
    color: Paper,
    fontSize: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    opacity: 0.65,
  },
  captionLight: {
    color: Ink,
  },
  missing: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  missingLabel: {
    fontFamily: DisplayFont,
    color: Paper,
    fontSize: 11,
    textAlign: 'center',
    textTransform: 'uppercase',
    opacity: 0.8,
  },
});
