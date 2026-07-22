import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';

import { Image } from 'expo-image';
import { Asset as MediaAsset } from 'expo-media-library';

import ShareIcon from '@/assets/icons/share.svg';
import XIcon from '@/assets/icons/x.svg';
import { ErrorBoundary } from '@/components/error-boundary';
import { frameTop, PhotoFrame } from '@/components/feed/photo-frame';
import { useCompositeCapture } from '@/components/recreate/use-composite-capture';
import { DisplayFont, FrameMargin, Ink, Paper, PhotoRatio } from '@/constants/theme';
import { getAssetRatio, setAssetRatio } from '@/lib/asset-ratio-cache';
import {
  filmCenterOffset,
  filmInitialScrollIndex,
  FILMSTRIP_PAD_H,
  THUMB_GAP,
  THUMB_SIZE,
  THUMB_STRIDE,
} from '@/lib/filmstrip-layout';
import { recreationUri, removeRecreation, type Recreation } from '@/lib/recreations';
import {
  computeThenNowInset,
  requestThenNowShare,
  type ThenNowPrimary,
  type ThenNowShare,
} from '@/lib/share-memory';
import { formatDistanceShort } from '@/utils/distance';
import { formatTimeAgo } from '@/utils/time-ago';

// Same dismiss feel as the Near Me viewer: drag down past this and release to
// close; under it the sheet springs back.
const DISMISS_THRESHOLD = 120;
// Vertical space the overlaid bottom chrome (action pills + filmstrip) takes,
// reserved by each page's frame math — mirrors FILMSTRIP_CHROME in the Near Me
// viewer.
const BOTTOM_CHROME = 128;
// Gap + time-ago line + distance sub-line below the frame.
const CAPTION_RESERVE = 88;

// Full-screen retake viewer, structured exactly like the Near Me viewer so the
// two feel identical: a horizontal paging FlatList (pages follow the finger),
// shared overlaid chrome (top bar, action pills, bottom filmstrip), a vertical
// drag-to-dismiss pan that fails over to the pager on horizontal movement, and
// the same open fade/scale. Pages render the retake in the app's black photo
// frame with the "then" photo as a white-bordered inset; captions come from
// the persisted record, so everything works even if the original library
// photo is gone (the then side degrades to a labeled panel / hidden inset).
export function RecreationViewer({
  items: itemsProp,
  startIndex,
  onClose,
}: {
  items: Recreation[];
  startIndex: number;
  onClose: () => void;
}) {
  const { width, height } = useWindowDimensions();
  // Freeze the list for this viewing session (same reason as the Near Me
  // viewer: a paging FlatList resets to offset 0 when its data identity
  // changes mid-scroll). Deleting inside the viewer closes it, so staleness
  // can't strand a dead record on screen.
  const [items] = useState(() => itemsProp);
  const [index, setIndex] = useState(startIndex);
  const current = items[Math.min(index, items.length - 1)];

  const [rollState, setRollState] = useState<'idle' | 'saving' | 'saved'>('idle');
  // Starts on the arrangement saved with the pair; tapping the inset swaps it
  // for this viewing (and for any share/save made while it's showing).
  const [primary, setPrimary] = useState<ThenNowPrimary>(current.primary);
  // Paging swaps the record under the shared chrome, so the per-recreation
  // state resets via the set-state-during-render "reset on prop change"
  // pattern (same as the settings sheet).
  const [forId, setForId] = useState(current.id);
  if (forId !== current.id) {
    setForId(current.id);
    setPrimary(current.primary);
    setRollState('idle');
  }
  const { captureComposite, captureElement } = useCompositeCapture();

  const pagerRef = useRef<FlatList<Recreation>>(null);
  const filmRef = useRef<FlatList<Recreation>>(null);

  // Open fade/scale + drag-down dismiss, mirroring the Near Me viewer.
  const translateY = useSharedValue(0);
  const openProgress = useSharedValue(0);
  useEffect(() => {
    openProgress.value = withTiming(1, { duration: 240, easing: Easing.out(Easing.cubic) });
  }, [openProgress]);
  const handleClose = () => {
    openProgress.value = withTiming(
      0,
      { duration: 200, easing: Easing.in(Easing.cubic) },
      (finished) => {
        'worklet';
        if (finished) scheduleOnRN(onClose);
      }
    );
  };
  const pan = Gesture.Pan()
    // Vertical-only: horizontal movement fails this pan over to the pager (and
    // the filmstrip), which is what keeps the side-swipe identical to Near Me.
    .activeOffsetY([-15, 15])
    .failOffsetX([-20, 20])
    .onUpdate((e) => {
      if (e.translationY > 0) translateY.value = e.translationY;
    })
    .onEnd((e) => {
      if (e.translationY > DISMISS_THRESHOLD) {
        scheduleOnRN(onClose);
      } else {
        translateY.value = withSpring(0);
      }
    });
  const containerStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));
  const openStyle = useAnimatedStyle(() => ({
    opacity: openProgress.value,
    transform: [{ scale: 0.96 + openProgress.value * 0.04 }],
  }));

  // Keep the active thumb centered as the pager moves. First run skipped: the
  // strip opens already centered via contentOffset, and animating from offset
  // 0 on mount read as a sweep (same pattern as the Near Me viewer).
  const filmCenteredOnce = useRef(false);
  useEffect(() => {
    if (!filmCenteredOnce.current) {
      filmCenteredOnce.current = true;
      return;
    }
    filmRef.current?.scrollToOffset({
      offset: filmCenterOffset(index, width),
      animated: true,
    });
  }, [index, width]);

  const jumpTo = (i: number) => {
    setIndex(i);
    pagerRef.current?.scrollToIndex({ index: i, animated: false });
  };

  const thenNowData: ThenNowShare = {
    oldAssetId: current.oldAssetId,
    newPhotoUri: recreationUri(current),
    oldCreationTime: current.oldCreationTime,
    oldLocation: current.oldLocation,
    primary,
    capturedDistanceM: current.capturedDistanceM,
  };

  const handleShare = () => {
    requestThenNowShare(thenNowData);
  };

  // Saves the CLEAN composite (photo + inset + chip) in the arrangement
  // currently showing. MediaLibraryNext asset creation; the app already holds
  // full read-write photo permission and the add-usage plist string.
  const handleSaveToRoll = async () => {
    if (rollState !== 'idle') return;
    setRollState('saving');
    try {
      const compositeUri = await captureComposite(thenNowData);
      await MediaAsset.create(compositeUri);
      setRollState('saved');
    } catch {
      setRollState('idle');
      Alert.alert("Couldn't save", 'This photo could not be saved to your camera roll.');
    }
  };

  const handleDelete = () => {
    Alert.alert(
      'Delete recreation?',
      'This removes the retaken photo from PastPic. Your original photo is not affected.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            void removeRecreation(current.id);
            onClose();
          },
        },
      ]
    );
  };

  return (
    <Animated.View style={[styles.root, openStyle]}>
      <GestureDetector gesture={pan}>
        <Animated.View style={[StyleSheet.absoluteFill, containerStyle]}>
          <FlatList
            ref={pagerRef}
            data={items}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            initialScrollIndex={startIndex}
            getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
            keyExtractor={(it) => it.id}
            extraData={`${index}|${primary}`}
            windowSize={3}
            initialNumToRender={1}
            maxToRenderPerBatch={2}
            // Intentionally NOT removeClippedSubviews — on a full-screen
            // horizontal pager it disturbs the scroll offset (see the Near Me
            // viewer's pager for the full story).
            onScrollToIndexFailed={({ index: i }) => {
              requestAnimationFrame(() =>
                pagerRef.current?.scrollToIndex({ index: i, animated: false })
              );
            }}
            onMomentumScrollEnd={(e) => {
              const next = Math.round(e.nativeEvent.contentOffset.x / width);
              if (next !== index) setIndex(next);
            }}
            renderItem={({ item: it, index: i }) => (
              <ErrorBoundary
                fallback={() => (
                  <View style={[styles.pageFallback, { width, height }]}>
                    <Text style={styles.fallbackText}>Couldn&apos;t show this retake.</Text>
                  </View>
                )}>
                <RecreationPage
                  rec={it}
                  width={width}
                  height={height}
                  // Only the current page is interactive; neighbors show their
                  // persisted arrangement statically.
                  primary={i === index ? primary : it.primary}
                  onSwap={
                    i === index
                      ? () => setPrimary((p) => (p === 'now' ? 'then' : 'now'))
                      : undefined
                  }
                />
              </ErrorBoundary>
            )}
          />

          <SafeAreaView style={styles.topBar} pointerEvents="box-none">
            <Pressable style={styles.closeBtn} onPress={handleClose} hitSlop={12}>
              <XIcon width={28} height={28} color={Ink} />
            </Pressable>
            <Pressable style={styles.shareBtn} onPress={handleShare} hitSlop={12}>
              <ShareIcon width={26} height={26} color={Ink} />
            </Pressable>
          </SafeAreaView>

          {/* Overlaid bottom chrome, like the Near Me viewer's bottomBar: the
              action pills and the filmstrip. Pages reserve BOTTOM_CHROME. */}
          <SafeAreaView style={styles.bottomBar} edges={['bottom']} pointerEvents="box-none">
            <View style={styles.actions}>
              <Pressable
                style={[styles.pill, rollState !== 'idle' && styles.pillDim]}
                onPress={handleSaveToRoll}
                disabled={rollState !== 'idle'}
                hitSlop={4}>
                <Text style={styles.pillLabel}>
                  {rollState === 'saved'
                    ? 'Saved'
                    : rollState === 'saving'
                      ? 'Saving'
                      : 'Save to photos'}
                </Text>
              </Pressable>
              <Pressable style={styles.pill} onPress={handleDelete} hitSlop={4}>
                <Text style={styles.pillLabel}>Delete</Text>
              </Pressable>
            </View>

            {/* Bottom filmstrip, mirroring the Near Me viewer's strip: opens
                centered on the current retake (contentOffset +
                initialScrollIndex compose — see lib/filmstrip-layout.ts), ink
                border marks the active thumb, tap jumps. */}
            <FlatList
              ref={filmRef}
              data={items}
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.filmstrip}
              keyExtractor={(it) => it.id}
              getItemLayout={(_, i) => ({
                length: THUMB_STRIDE,
                offset: FILMSTRIP_PAD_H + i * THUMB_STRIDE,
                index: i,
              })}
              contentOffset={{ x: filmCenterOffset(startIndex, width), y: 0 }}
              initialScrollIndex={filmInitialScrollIndex(startIndex, width, items.length)}
              extraData={index}
              renderItem={({ item: it, index: i }) => (
                <Pressable
                  onPress={() => jumpTo(i)}
                  style={[styles.thumbWrap, i === index && styles.thumbWrapActive]}>
                  <Image
                    source={{ uri: recreationUri(it) }}
                    style={styles.thumb}
                    contentFit="cover"
                    cachePolicy="memory-disk"
                    priority="low"
                    transition={0}
                  />
                </Pressable>
              )}
            />
          </SafeAreaView>

          {/* Off-screen clean-composite renderer used by Save to camera roll. */}
          {captureElement}
        </Animated.View>
      </GestureDetector>
    </Animated.View>
  );
}

// One pager page: the retake in the app's black photo frame (the same chrome as
// the feed card and the Near Me viewer page), the other photo of the pair as a
// white-bordered inset, and the Near Me caption grammar below the frame. All
// geometry is computed synchronously from the window + insets — no onLayout
// wait — so a page is fully drawn on its first frame while the pager is still
// moving (the old onLayout-sized preview mounted blank, then popped).
const RecreationPage = function RecreationPage({
  rec,
  width,
  height,
  primary,
  onSwap,
}: {
  rec: Recreation;
  width: number;
  height: number;
  primary: ThenNowPrimary;
  onSwap?: () => void;
}) {
  const insets = useSafeAreaInsets();
  const nowUri = recreationUri(rec);
  const thenUri = rec.oldAssetId;

  // Keyed by uri so a rerender can't carry a failure across records.
  const [thenFailedFor, setThenFailedFor] = useState<string | null>(null);
  const thenFailed = thenFailedFor === thenUri;
  // Same cover/contain rule as everywhere for the old photo when it's the big
  // one (an inset is always cover): seeded from the shared ratio cache,
  // corrected on load.
  const cachedRatio = getAssetRatio(thenUri);
  const [loadedLandscape, setLoadedLandscape] = useState(false);
  const thenLandscape = loadedLandscape || (cachedRatio !== undefined && cachedRatio > 1);
  // Quiet gray until the big image first paints (or degrades to the missing
  // panel), then the black chrome arrives with the photo — same behavior as
  // the Near Me viewer page. Sticky on purpose: a primary swap replaces the
  // big image with one that's already decoded, and flashing back to gray for
  // that would read as a glitch.
  const [painted, setPainted] = useState(false);

  const bigIsThen = primary === 'then';
  const bigUri = bigIsThen ? thenUri : nowUri;
  const insetUri = bigIsThen ? nowUri : thenUri;
  const insetIsThen = !bigIsThen;

  // Retakes are captured in the app's 3:4 frame, so the page uses the fixed
  // PhotoRatio box (like the feed card), centered in the band between the
  // header and the overlaid bottom chrome — same banding as the Near Me page.
  const top0 = frameTop(insets.top);
  const available = Math.max(0, height - top0 - BOTTOM_CHROME - insets.bottom - CAPTION_RESERVE);
  let frameW = width - 2 * FrameMargin;
  let frameH = frameW / PhotoRatio;
  if (frameH > available) {
    frameH = available;
    frameW = frameH * PhotoRatio;
  }
  const frameLeft = (width - frameW) / 2;
  const top = top0 + Math.max(0, (available - frameH) / 2);
  const captionTop = top + frameH + 24;
  const inset = computeThenNowInset(frameW, PhotoRatio);

  const distance = formatDistanceShort(rec.capturedDistanceM);

  return (
    <View style={{ width, height, backgroundColor: Paper }}>
      <PhotoFrame
        screenW={width}
        top={top}
        width={frameW}
        height={frameH}
        left={frameLeft}
        placeholder={!painted && !(bigIsThen && thenFailed)}>
        {bigIsThen && thenFailed ? (
          <View style={styles.missing}>
            <Text style={styles.missingLabel}>
              Original photo is no longer in your library
            </Text>
          </View>
        ) : (
          <Image
            source={{ uri: bigUri }}
            style={StyleSheet.absoluteFill}
            contentFit={bigIsThen && thenLandscape ? 'contain' : 'cover'}
            cachePolicy="memory-disk"
            transition={120}
            onLoad={(e) => {
              setPainted(true);
              if (bigIsThen) {
                const { width: w, height: h } = e.source ?? {};
                if (w && h) {
                  setAssetRatio(thenUri, w / h);
                  if (w > h) setLoadedLandscape(true);
                }
              }
            }}
            onError={bigIsThen ? () => setThenFailedFor(thenUri) : undefined}
          />
        )}

        {!(insetIsThen && thenFailed) ? (
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
              },
            ]}>
            <Image
              source={{ uri: insetUri }}
              style={StyleSheet.absoluteFill}
              contentFit="cover"
              cachePolicy="memory-disk"
              transition={120}
              onLoad={
                insetIsThen
                  ? (e) => {
                      const { width: w, height: h } = e.source ?? {};
                      if (w && h) {
                        setAssetRatio(thenUri, w / h);
                        if (w > h) setLoadedLandscape(true);
                      }
                    }
                  : undefined
              }
              onError={insetIsThen ? () => setThenFailedFor(thenUri) : undefined}
            />
            {/* One-word disambiguation on the small panel only; the big
                photo's identity is implied by the caption. */}
            <View style={styles.insetTag} pointerEvents="none">
              <Text style={styles.insetTagLabel}>{insetIsThen ? 'Then' : 'Now'}</Text>
            </View>
          </Pressable>
        ) : null}
      </PhotoFrame>

      <View style={[styles.caption, { top: captionTop }]} pointerEvents="none">
        <Text
          style={styles.timeAgo}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.4}>
          {formatTimeAgo(rec.oldCreationTime)}
        </Text>
        {distance ? <Text style={styles.place}>{distance}</Text> : null}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  root: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: Paper,
  },
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  closeBtn: {
    marginTop: 2,
    marginLeft: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  shareBtn: {
    marginTop: 2,
    marginRight: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
  },
  pageFallback: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  fallbackText: {
    fontFamily: DisplayFont,
    color: Ink,
    fontSize: 14,
    textAlign: 'center',
    textTransform: 'uppercase',
    opacity: 0.7,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingBottom: 8,
    marginHorizontal: 24,
  },
  pill: {
    flex: 1,
    paddingVertical: 10.5,
    borderRadius: 32,
    borderWidth: 1.5,
    borderColor: Ink,
    alignItems: 'center',
    backgroundColor: Paper,
  },
  pillDim: {
    opacity: 0.5,
  },
  pillLabel: {
    fontFamily: DisplayFont,
    color: Ink,
    fontSize: 13,
    textTransform: 'uppercase',
  },
  filmstrip: {
    // Spacing via thumbWrap's marginRight (not `gap`) so the fixed-stride
    // getItemLayout math stays exact — same rule as the Near Me strip.
    paddingHorizontal: FILMSTRIP_PAD_H,
    paddingTop: 8,
    paddingBottom: 8,
  },
  thumbWrap: {
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    marginRight: THUMB_GAP,
    borderRadius: 6,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: 'transparent',
    backgroundColor: '#E9E9E9',
  },
  thumbWrapActive: {
    borderColor: Ink,
  },
  thumb: {
    width: '100%',
    height: '100%',
  },
  // The white-bordered then/now inset inside the frame (BeReal grammar).
  inset: {
    position: 'absolute',
    borderColor: Paper,
    overflow: 'hidden',
    backgroundColor: '#E9E9E9',
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
  // Time-ago + distance below the frame, matching the Near Me viewer caption.
  caption: {
    position: 'absolute',
    left: FrameMargin,
    right: FrameMargin,
    alignItems: 'stretch',
  },
  timeAgo: {
    fontFamily: DisplayFont,
    fontSize: 30,
    color: Ink,
    textTransform: 'uppercase',
    textAlign: 'center',
  },
  place: {
    fontFamily: DisplayFont,
    fontSize: 11,
    lineHeight: 16,
    color: Ink,
    textTransform: 'uppercase',
    textAlign: 'center',
    marginTop: 6,
    opacity: 0.65,
  },
});
