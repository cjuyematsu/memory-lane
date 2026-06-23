import { memo, useEffect, useRef, useState } from 'react';
import {
  AppState,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { Image } from 'expo-image';
import { MediaType } from 'expo-media-library';
import { useVideoPlayer, VideoView } from 'expo-video';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import FilmIcon from '@/assets/icons/film.svg';
import ShareIcon from '@/assets/icons/share.svg';
import XIcon from '@/assets/icons/x.svg';
import { PhotoFrame, frameTop } from '@/components/feed/photo-frame';
import { PinchZoom } from '@/components/pinch-zoom';
import { DisplayFont, FrameMargin, Ink, Paper, PhotoRatio } from '@/constants/theme';
import { usePlaybackUri } from '@/hooks/use-asset-metadata';
import { useReverseGeocode } from '@/hooks/use-reverse-geocode';
import type { NearbyAsset } from '@/hooks/use-nearby-assets';
import { getAssetRatio, setAssetRatio } from '@/lib/asset-ratio-cache';
import { requestShare } from '@/lib/share-memory';
import { formatTimeAgo } from '@/utils/time-ago';

const THUMB_SIZE = 56;
const THUMB_GAP = 6;
const DISMISS_THRESHOLD = 120;

// Vertical space (above the safe-area inset) reserved at the bottom for each
// mode's chrome, plus the space the caption needs below the frame. The frame
// is sized to fill whatever is left, so it stays inside the screen on every
// device instead of being a fixed full-width 3:4 box that can overrun short
// phones.
const FILMSTRIP_CHROME = 132; // film button + filmstrip thumbs + paddings
const STORY_CHROME = 24; // memories mode has no filmstrip, just breathing room
const CAPTION_RESERVE = 104; // gap + time-ago + place line(s) below the frame

// Cap how tall (narrow) a frame may get. A photo taller than this would be
// clamped by the available height into a narrow sliver that wastes the screen
// width; instead we widen the frame to this ratio and let the image cover-crop
// the excess top/bottom. Photos at this ratio or wider (the common 3:4 = 0.75,
// 2:3, and all landscape) keep their exact shape and are never cropped — so only
// genuinely very tall photos (taller than 2:3) lose a little top and bottom.
const MIN_FRAME_RATIO = 2 / 3;

export function Viewer({
  items: itemsProp,
  startIndex,
  isActive = true,
  onClose,
  onOpenMemoryFeed,
  onIndexChange,
  tapToAdvance = false,
}: {
  items: NearbyAsset[];
  startIndex: number;
  isActive?: boolean;
  onClose: () => void;
  onOpenMemoryFeed?: (assetId: string) => void;
  // Reports the photo currently on screen as it changes, so the parent can keep
  // its "open at" index live — that way reopening (or a remount) restores the
  // photo you were on, not the one you first tapped.
  onIndexChange?: (index: number) => void;
  // Story-style navigation: tap right half → next, left half → previous, and
  // horizontal swipe is disabled. Used by the memories view.
  tapToAdvance?: boolean;
}) {
  const { width, height } = useWindowDimensions();
  // Freeze the list for this viewing session. The parent's `items` gets a new
  // array reference whenever the background nearby-scan or a MediaLibrary
  // change reloads, and a paging FlatList resets to offset 0 when its `data`
  // identity changes mid-scroll — which snapped the pager back to the first
  // photo. Snapshot on open; closing and reopening picks up any new photos.
  const [items] = useState(() => itemsProp);
  const [index, setIndex] = useState(startIndex);
  // True while a pinch-zoom is in progress; gates the dismiss pan and the pager so
  // a two-finger zoom can't also drag-to-close or page to the next photo.
  const [zooming, setZooming] = useState(false);
  const pagerRef = useRef<FlatList<NearbyAsset>>(null);
  const filmRef = useRef<ScrollView>(null);

  const translateY = useSharedValue(0);
  const backdropOpacity = useSharedValue(1);
  const openProgress = useSharedValue(0);

  useEffect(() => {
    openProgress.value = withTiming(1, {
      duration: 240,
      easing: Easing.out(Easing.cubic),
    });
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
    .enabled(!zooming)
    .activeOffsetY([-15, 15])
    .failOffsetX([-20, 20])
    .onUpdate((e) => {
      if (e.translationY > 0) {
        translateY.value = e.translationY;
        backdropOpacity.value = Math.max(0.5, 1 - e.translationY / height);
      }
    })
    .onEnd((e) => {
      if (e.translationY > DISMISS_THRESHOLD) {
        scheduleOnRN(onClose);
      } else {
        translateY.value = withSpring(0);
        backdropOpacity.value = withSpring(1);
      }
    });

  const containerStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));
  const backdropStyle = useAnimatedStyle(() => ({
    opacity: backdropOpacity.value,
  }));
  const openStyle = useAnimatedStyle(() => ({
    opacity: openProgress.value,
    transform: [{ scale: 0.96 + openProgress.value * 0.04 }],
  }));

  useEffect(() => {
    const thumbStride = THUMB_SIZE + THUMB_GAP;
    filmRef.current?.scrollTo({
      x: Math.max(0, index * thumbStride - width / 2 + THUMB_SIZE / 2),
      animated: true,
    });
  }, [index, width]);

  useEffect(() => {
    const uris: string[] = [];
    for (const d of [-2, -1, 1, 2, 3]) {
      const it = items[index + d];
      if (it) uris.push(it.asset.id);
    }
    if (uris.length > 0) Image.prefetch(uris).catch(() => {});
  }, [index, items]);

  // Report the on-screen photo up to the parent (fires once per settled swipe),
  // so reopening — or a remount around the memory feed — lands on the live
  // photo, not the one first tapped.
  useEffect(() => {
    onIndexChange?.(index);
  }, [index, onIndexChange]);

  const jumpTo = (i: number) => {
    setIndex(i);
    pagerRef.current?.scrollToIndex({ index: i, animated: false });
  };

  const goNext = () => {
    if (index < items.length - 1) jumpTo(index + 1);
  };
  const goPrev = () => {
    if (index > 0) jumpTo(index - 1);
  };

  const shareCurrent = () => {
    const it = items[index];
    if (it) requestShare(it.asset, it.mediaType === MediaType.VIDEO);
  };

  return (
    <Animated.View style={[StyleSheet.absoluteFill, openStyle]}>
      <Animated.View style={[styles.backdrop, backdropStyle]} />
      <GestureDetector gesture={pan}>
        <Animated.View style={[StyleSheet.absoluteFill, containerStyle]}>
          <FlatList
            ref={pagerRef}
            data={items}
            horizontal
            pagingEnabled
            scrollEnabled={!tapToAdvance && !zooming}
            showsHorizontalScrollIndicator={false}
            initialScrollIndex={startIndex}
            getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
            keyExtractor={(it) => it.asset.id}
            renderItem={({ item, index: i }) => (
              <ViewerPage
                item={item}
                isCurrent={i === index}
                isActive={isActive}
                width={width}
                height={height}
                bottomChrome={tapToAdvance ? STORY_CHROME : FILMSTRIP_CHROME}
                onZoomChange={setZooming}
              />
            )}
            extraData={index}
            windowSize={3}
            initialNumToRender={1}
            maxToRenderPerBatch={2}
            // Intentionally NOT removeClippedSubviews: on a full-screen
            // horizontal pager it detaches/re-attaches the page on each
            // swipe-driven re-render, which disturbed the scroll offset and
            // snapped the pager back to initialScrollIndex (the opened photo).
            // windowSize={3} keeps only ~3 pages realized, so the cost is tiny.
            onScrollToIndexFailed={({ index: i }) => {
              // getItemLayout makes this rare; retry on the next frame.
              requestAnimationFrame(() =>
                pagerRef.current?.scrollToIndex({ index: i, animated: false })
              );
            }}
            onMomentumScrollEnd={(e) => {
              const next = Math.round(e.nativeEvent.contentOffset.x / width);
              if (next !== index) setIndex(next);
            }}
          />

          {tapToAdvance ? (
            <View style={styles.tapZones}>
              <Pressable style={styles.tapZone} onPress={goPrev} />
              <Pressable style={styles.tapZone} onPress={goNext} />
            </View>
          ) : null}

          {tapToAdvance ? (
            // IG-style: segmented progress bars at the top, no filmstrip.
            <SafeAreaView edges={['top']} style={styles.storyTop} pointerEvents="box-none">
              <View style={styles.progressRow}>
                {items.length <= 30 ? (
                  items.map((it, i) => (
                    <View key={it.asset.id} style={styles.segTrack}>
                      <View
                        style={[styles.segFill, i <= index && styles.segFillOn]}
                      />
                    </View>
                  ))
                ) : (
                  <View style={styles.segTrack}>
                    <View
                      style={[
                        styles.segFillOn,
                        { width: `${((index + 1) / items.length) * 100}%` },
                      ]}
                    />
                  </View>
                )}
              </View>
              <View style={styles.storyControls}>
                <Pressable style={styles.storyBtn} onPress={shareCurrent} hitSlop={12}>
                  <ShareIcon width={28} height={28} color={Ink} />
                </Pressable>
                <Pressable style={styles.storyBtn} onPress={handleClose} hitSlop={12}>
                  <XIcon width={28} height={28} color={Ink} />
                </Pressable>
              </View>
            </SafeAreaView>
          ) : (
            <>
              <SafeAreaView style={styles.topBar} pointerEvents="box-none">
                <Pressable style={styles.closeBtn} onPress={handleClose} hitSlop={12}>
                  <XIcon width={28} height={28} color={Ink} />
                </Pressable>
                <Pressable style={styles.shareBtn} onPress={shareCurrent} hitSlop={12}>
                  <ShareIcon width={28} height={28} color={Ink} />
                </Pressable>
              </SafeAreaView>

              <SafeAreaView
                style={styles.bottomBar}
                edges={['bottom']}
                pointerEvents="box-none">
                {onOpenMemoryFeed ? (
                  <View style={styles.filmRow} pointerEvents="box-none">
                    <Pressable
                      onPress={() => onOpenMemoryFeed(items[index].asset.id)}
                      style={styles.filmBtn}
                      hitSlop={12}>
                      <FilmIcon width={28} height={28} color={Ink} />
                    </Pressable>
                  </View>
                ) : null}
                <ScrollView
                  ref={filmRef}
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.filmstrip}>
                  {items.map((it, i) => (
                    <Pressable
                      key={it.asset.id}
                      onPress={() => jumpTo(i)}
                      style={[styles.thumbWrap, i === index && styles.thumbWrapActive]}>
                      <FilmstripThumb item={it} />
                    </Pressable>
                  ))}
                </ScrollView>
              </SafeAreaView>
            </>
          )}
        </Animated.View>
      </GestureDetector>
    </Animated.View>
  );
}

const ViewerPage = memo(function ViewerPage({
  item,
  isCurrent,
  isActive,
  width,
  height,
  bottomChrome,
  onZoomChange,
}: {
  item: NearbyAsset;
  isCurrent: boolean;
  isActive: boolean;
  width: number;
  height: number;
  bottomChrome: number;
  onZoomChange: (active: boolean) => void;
}) {
  const insets = useSafeAreaInsets();
  const placeName = useReverseGeocode(item.location);
  const isVideo = item.mediaType === MediaType.VIDEO;
  const playbackUri = usePlaybackUri(isVideo && isCurrent ? item.asset : null);
  // content:// (Android) / ph:// (iOS) via asset.id — scoped-storage safe,
  // unlike the file:// path that rendered blank on Android.
  const thumbnailUri = item.asset.id;
  // Seed from the shared ratio cache (populated by the grid as tiles decode) so
  // the frame opens at the asset's true shape — no 3:4 default then resize snap.
  const [ratio, setRatio] = useState<number | null>(
    () => getAssetRatio(item.asset.id) ?? null
  );

  // The black frame hugs each photo's own aspect ratio (the largest box of that
  // shape that fits the available area), instead of forcing a fixed 3:4 box —
  // so off-ratio photos fill the frame edge-to-edge with no awkward black bars.
  // Very tall photos (taller than MIN_FRAME_RATIO) are the exception: hugging
  // them would clamp the frame to a narrow sliver that wastes the screen width,
  // so they're widened to the cap and cover-cropped (below) to fill it. Defaults
  // to 3:4 until the image reports its dimensions, then snaps to its real shape.
  // The frame is centered in the band between the header and the bottom chrome
  // (which reserves room for the caption).
  const top0 = frameTop(insets.top);
  const available = Math.max(
    0,
    height - top0 - bottomChrome - insets.bottom - CAPTION_RESERVE
  );
  const maxFrameW = width - 2 * FrameMargin;
  const realR = ratio ?? PhotoRatio;
  // Never let the frame get narrower than the cap; a too-tall photo is widened to
  // MIN_FRAME_RATIO and cover-cropped rather than shrunk to a width-wasting sliver.
  const r = Math.max(realR, MIN_FRAME_RATIO);
  const cropped = realR < MIN_FRAME_RATIO;
  let frameW = maxFrameW;
  let frameH = frameW / r;
  if (frameH > available) {
    frameH = available;
    frameW = frameH * r;
  }
  const frameLeft = (width - frameW) / 2;
  const top = top0 + Math.max(0, (available - frameH) / 2);
  const captionTop = top + frameH + 24;

  return (
    <View style={{ width, height, backgroundColor: Paper }}>
      <PhotoFrame screenW={width} top={top} width={frameW} height={frameH} left={frameLeft}>
        <PinchZoom onActiveChange={onZoomChange}>
          {thumbnailUri ? (
            <Image
              source={{ uri: thumbnailUri }}
              style={StyleSheet.absoluteFill}
              // Tall photos are capped to a wider frame, so cover-crop them to fill
              // it; everything else hugs its exact ratio, where contain fills with
              // no crop.
              contentFit={cropped ? 'cover' : 'contain'}
              cachePolicy="memory-disk"
              transition={0}
              // No recyclingKey: the pager is a paging FlatList (mount/unmount,
              // not view recycling), where recyclingKey only resets the image to
              // blank before loading — a flash. It belongs on recycling lists.
              onLoad={(e) => {
                const { width: w, height: h } = e.source ?? {};
                if (w && h) {
                  setRatio(w / h);
                  setAssetRatio(item.asset.id, w / h);
                }
              }}
            />
          ) : null}
          {isVideo && isCurrent && isActive && playbackUri ? (
            <ViewerVideo uri={playbackUri} contentFit={cropped ? 'cover' : 'contain'} />
          ) : null}
        </PinchZoom>
      </PhotoFrame>

      <View style={[styles.caption, { top: captionTop }]} pointerEvents="none">
        <Text
          style={styles.timeAgo}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.4}>
          {formatTimeAgo(item.creationTime)}
        </Text>
        {placeName ? (
          <Text style={styles.place}>
            {item.isEstimated ? '~ ' : ''}
            {placeName}
          </Text>
        ) : null}
      </View>
    </View>
  );
});

function ViewerVideo({ uri, contentFit }: { uri: string; contentFit: 'cover' | 'contain' }) {
  const player = useVideoPlayer(uri, (p) => {
    p.loop = true;
    p.muted = true;
    // Mix with other apps' audio so a (muted) video never interrupts the
    // user's background music. The default 'auto' still interrupts here.
    p.audioMixingMode = 'mixWithOthers';
    p.play();
  });

  // Backgrounding the app leaves the player's AVPlayerItem stalled, so on return
  // the video sits frozen on the last frame (play() resumes audio only). On a
  // real background→foreground we reload the source — replaceAsync, the required
  // path for the ph:// PHAsset URIs we pass — which rebuilds a live item and
  // render surface in place, then play. We deliberately do NOT remount the
  // VideoView: an earlier key-bump did, but tearing the view down and back up
  // read as a jerky flash; reloading the item on the still-mounted view is
  // smoother. Restarts the clip from the top (fine here: muted + looping). The
  // explicit "was backgrounded" flag keeps benign inactive→active blips (Control
  // Center, a notification) from reloading.
  const wasBackgrounded = useRef(false);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'background') {
        wasBackgrounded.current = true;
      } else if (s === 'active' && wasBackgrounded.current) {
        wasBackgrounded.current = false;
        player
          .replaceAsync(uri)
          .then(() => {
            player.muted = true;
            player.loop = true;
            player.audioMixingMode = 'mixWithOthers';
            player.play();
          })
          .catch(() => {});
      }
    });
    return () => sub.remove();
  }, [player, uri]);

  return (
    <VideoView
      key={uri}
      player={player}
      style={StyleSheet.absoluteFill}
      contentFit={contentFit}
      nativeControls={false}
    />
  );
}

const FilmstripThumb = memo(function FilmstripThumb({ item }: { item: NearbyAsset }) {
  const isVideo = item.mediaType === MediaType.VIDEO;
  return (
    <View style={styles.thumb}>
      <Image
        source={{ uri: item.asset.id }}
        style={styles.thumb}
        contentFit="cover"
        cachePolicy="memory-disk"
        transition={0}
        // No recyclingKey: filmstrip thumbs live in a ScrollView (all mounted,
        // no recycling), so it would only add the reset-to-blank flash.
      />
      {isVideo ? (
        <View style={styles.thumbPlayBadge} pointerEvents="none">
          <View style={styles.thumbPlayTriangle} />
        </View>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: Paper,
  },
  // Central tap band for story navigation; inset from the top (progress bars)
  // and bottom so controls keep their own taps.
  tapZones: {
    position: 'absolute',
    top: 90,
    bottom: 60,
    left: 0,
    right: 0,
    flexDirection: 'row',
  },
  tapZone: {
    flex: 1,
  },
  storyTop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
  },
  progressRow: {
    flexDirection: 'row',
    gap: 3,
    paddingHorizontal: 10,
    paddingTop: 8,
  },
  segTrack: {
    flex: 1,
    height: 3,
    borderRadius: 2,
    backgroundColor: 'rgba(0,0,0,0.15)',
    overflow: 'hidden',
  },
  segFill: {
    width: '0%',
    height: '100%',
    borderRadius: 2,
  },
  segFillOn: {
    width: '100%',
    height: '100%',
    borderRadius: 2,
    backgroundColor: Ink,
  },
  storyControls: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 14,
    marginTop: 2,
  },
  storyBtn: {
    paddingHorizontal: 4,
    paddingVertical: 8,
  },
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
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
  filmRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: 12,
    paddingBottom: 8,
  },
  filmBtn: {
    padding: 6,
  },
  filmstrip: {
    gap: THUMB_GAP,
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 16,
  },
  thumbWrap: {
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: 6,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  thumbWrapActive: {
    borderColor: Ink,
  },
  thumb: {
    width: '100%',
    height: '100%',
  },
  thumbPlayBadge: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbPlayTriangle: {
    width: 0,
    height: 0,
    borderLeftWidth: 9,
    borderTopWidth: 6,
    borderBottomWidth: 6,
    borderLeftColor: 'rgba(255,255,255,0.95)',
    borderTopColor: 'transparent',
    borderBottomColor: 'transparent',
    marginLeft: 2,
  },
  // Time-ago + place below the frame, matching the feed caption.
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
    letterSpacing: 0.5,
    marginTop: 10,
  },
});
