import { memo, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  FlatList,
  Pressable,
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

import CameraIcon from '@/assets/icons/camera.svg';
import FilmIcon from '@/assets/icons/film.svg';
import ShareIcon from '@/assets/icons/share.svg';
import XIcon from '@/assets/icons/x.svg';
import { ErrorBoundary } from '@/components/error-boundary';
import { PhotoFrame, frameTop } from '@/components/feed/photo-frame';
import { PinchZoom } from '@/components/pinch-zoom';
import { DisplayFont, FrameMargin, Ink, Paper, PhotoRatio } from '@/constants/theme';
import { usePlaybackUri } from '@/hooks/use-asset-metadata';
import { useIcloudImageLoad } from '@/hooks/use-icloud-image-load';
import { useReverseGeocode } from '@/hooks/use-reverse-geocode';
import type { NearbyAsset } from '@/hooks/use-nearby-assets';
import { getAssetRatio, setAssetRatio } from '@/lib/asset-ratio-cache';
import {
  FILMSTRIP_PAD_H,
  THUMB_GAP,
  THUMB_SIZE,
  THUMB_STRIDE,
  filmCenterOffset,
  filmInitialScrollIndex,
} from '@/lib/filmstrip-layout';
import { requestRecreation } from '@/lib/recreation-request';
import { requestShare } from '@/lib/share-memory';
import { formatTimeAgo } from '@/utils/time-ago';

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
  const filmRef = useRef<FlatList<NearbyAsset>>(null);

  const translateY = useSharedValue(0);
  const backdropOpacity = useSharedValue(1);
  const openProgress = useSharedValue(0);

  useEffect(() => {
    openProgress.value = withTiming(1, {
      duration: 240,
      easing: Easing.out(Easing.cubic),
    });
  }, [openProgress]);

  // Ease-OUT so the fade starts the moment the tap lands (ease-in held near-full
  // opacity then popped — read as jerky; same fix as the retake viewer).
  const handleClose = () => {
    openProgress.value = withTiming(
      0,
      { duration: 160, easing: Easing.out(Easing.quad) },
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
        // Carry the drag through with a slide+fade instead of a hard cut
        // (same fix as the retake viewer).
        translateY.value = withTiming(height, { duration: 160, easing: Easing.out(Easing.quad) });
        openProgress.value = withTiming(0, { duration: 160, easing: Easing.out(Easing.quad) }, () => {
          'worklet';
          scheduleOnRN(onClose);
        });
      } else {
        translateY.value = withSpring(0);
        backdropOpacity.value = withSpring(1);
      }
    });

  const containerStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));
  // Backdrop leads the open fade (opaque by the halfway point) and thins with
  // a drag-dismiss; the content fades/scaling above it. Fading the whole
  // viewer as one sheet double-exposed the photo onto the grid (mushy
  // ghosting) — same two-layer recipe as the retake viewer.
  const backdropStyle = useAnimatedStyle(() => ({
    opacity: Math.min(1, openProgress.value * 2) * backdropOpacity.value,
  }));
  const openStyle = useAnimatedStyle(() => ({
    opacity: openProgress.value,
    transform: [{ scale: 0.96 + openProgress.value * 0.04 }],
  }));

  // Keep the active thumb centered as the pager moves. The first run is skipped:
  // the filmstrip opens already centered via `contentOffset`, and animating from
  // offset 0 on mount read as a sweep across the whole strip.
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

  // NOTE: do not Image.prefetch() the neighbor ph:// URIs here. expo-image's
  // prefetch path has no view-size context, so it requests
  // PHImageManagerMaximumSize — for an iCloud-optimized library that downloads
  // and decodes the FULL-resolution originals (5 at a time), which spiked
  // memory and could jetsam the app. The pager already mounts ±1 neighbors
  // (windowSize), and those decode at view size — enough lookahead without the
  // OOM risk. (Same reason the feed deliberately avoids prefetch.)

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

  // Open the recreation camera for the current photo. NearbyAsset carries its
  // location/creationTime inline, so no metadata cache lookup is needed.
  const recreateCurrent = () => {
    const it = items[index];
    if (!it || it.mediaType === MediaType.VIDEO) return;
    requestRecreation({
      asset: it.asset,
      creationTime: it.creationTime,
      location: it.location,
    });
  };

  return (
    <View style={StyleSheet.absoluteFill}>
      <Animated.View style={[styles.backdrop, backdropStyle]} />
      <Animated.View style={[StyleSheet.absoluteFill, openStyle]}>
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
              <ErrorBoundary
                fallback={() => (
                  <View style={[styles.pageFallback, { width, height }]}>
                    <Text style={styles.fallbackText}>Couldn&apos;t show this memory.</Text>
                  </View>
                )}>
                <ViewerPage
                  item={item}
                  isCurrent={i === index}
                  isActive={isActive}
                  width={width}
                  height={height}
                  bottomChrome={tapToAdvance ? STORY_CHROME : FILMSTRIP_CHROME}
                  onZoomChange={setZooming}
                />
              </ErrorBoundary>
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
                {/* The cluster view is the most on-premise recreation moment
                    (a notification just said "you're at the spot"), so the
                    camera lives here too — photos only, like everywhere. */}
                <View style={styles.storyActions}>
                  {items[index]?.mediaType !== MediaType.VIDEO ? (
                    <Pressable style={styles.storyBtn} onPress={recreateCurrent} hitSlop={12}>
                      <CameraIcon width={26} height={26} color={Ink} />
                    </Pressable>
                  ) : null}
                  <Pressable style={styles.storyBtn} onPress={shareCurrent} hitSlop={12}>
                    <ShareIcon width={26} height={26} color={Ink} />
                  </Pressable>
                </View>
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
                <View style={styles.topActions}>
                  {items[index]?.mediaType !== MediaType.VIDEO ? (
                    <Pressable
                      style={styles.shareBtn}
                      onPress={recreateCurrent}
                      hitSlop={12}>
                      <CameraIcon width={26} height={26} color={Ink} />
                    </Pressable>
                  ) : null}
                  <Pressable style={styles.shareBtn} onPress={shareCurrent} hitSlop={12}>
                    <ShareIcon width={26} height={26} color={Ink} />
                  </Pressable>
                </View>
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
                      <FilmIcon width={26} height={26} color={Ink} />
                    </Pressable>
                  </View>
                ) : null}
                <FlatList
                  ref={filmRef}
                  data={items}
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.filmstrip}
                  // Windowed on purpose: a dense area can put hundreds of items
                  // here, and the old ScrollView mounted every thumb at open —
                  // hundreds of simultaneous PHImageManager requests competing
                  // with the page image. Only thumbs near the viewport mount.
                  windowSize={3}
                  initialNumToRender={Math.ceil(width / THUMB_STRIDE) + 4}
                  maxToRenderPerBatch={12}
                  keyExtractor={(it) => it.asset.id}
                  getItemLayout={(_, i) => ({
                    length: THUMB_STRIDE,
                    offset: FILMSTRIP_PAD_H + i * THUMB_STRIDE,
                    index: i,
                  })}
                  // Open already centered on the tapped photo — no scroll sweep.
                  // contentOffset positions the scroll; initialScrollIndex seeds
                  // the initial RENDER REGION at the same spot (without it the
                  // region is cells [0, initialNumToRender) and a deep open shows
                  // a blank strip until scroll events arrive). With contentOffset
                  // set, the list skips its own initialScrollIndex scroll, so the
                  // two compose — see lib/filmstrip-layout.ts.
                  contentOffset={{ x: filmCenterOffset(startIndex, width), y: 0 }}
                  initialScrollIndex={filmInitialScrollIndex(startIndex, width, items.length)}
                  extraData={index}
                  renderItem={({ item: it, index: i }) => (
                    <Pressable
                      onPress={() => jumpTo(i)}
                      style={[styles.thumbWrap, i === index && styles.thumbWrapActive]}>
                      <FilmstripThumb item={it} />
                    </Pressable>
                  )}
                />
              </SafeAreaView>
            </>
          )}
        </Animated.View>
      </GestureDetector>
      </Animated.View>
    </View>
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
  // Bounded load with the same recovery as the feed, so a stalled iCloud original
  // surfaces "Accessing…" then Retry instead of a blank frame. Photos only: a video
  // plays over its poster, so a slow poster shouldn't claim "couldn't load". Timers
  // run only on the page the user is looking at (the deadline measures their wait,
  // not how long a ±1 neighbor has been mounted).
  const load = useIcloudImageLoad(item.asset.id, { enabled: isCurrent && isActive });
  const stalled = load.unreachable && !isVideo;
  const accessingLabel =
    load.progressPct != null
      ? `Accessing from iCloud… ${load.progressPct}%`
      : 'Accessing from iCloud…';
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
      {/* Quiet gray until anything paints (blur or final): opening/swiping to a
          still-loading photo used to pop an empty black-outlined frame first,
          which read as a glitch against the white canvas. The black chrome now
          arrives with the image itself. */}
      <PhotoFrame
        screenW={width}
        top={top}
        width={frameW}
        height={frameH}
        left={frameLeft}
        placeholder={!load.showing}>
        <PinchZoom onActiveChange={onZoomChange}>
          {thumbnailUri && !(stalled && !load.preview) ? (
            <Image
              // The nonce remounts the image for a fresh fetch when the user taps
              // Retry over a still-showing blurred preview (without it the mounted
              // view would never re-issue the stalled request).
              key={`${item.asset.id}:${load.reloadNonce}`}
              source={{ uri: thumbnailUri }}
              style={StyleSheet.absoluteFill}
              // Tall photos are capped to a wider frame, so cover-crop them to fill
              // it; everything else hugs its exact ratio, where contain fills with
              // no crop.
              contentFit={cropped ? 'cover' : 'contain'}
              cachePolicy="memory-disk"
              // Newly-started loads on the visible page outrank the ±1 neighbors'.
              priority={isCurrent ? 'high' : 'low'}
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
                load.onLoad(e);
              }}
              onError={load.onError}
              onProgress={load.onProgress}
            />
          ) : null}
          {isVideo && isCurrent && isActive && playbackUri ? (
            <ViewerVideo uri={playbackUri} contentFit={cropped ? 'cover' : 'contain'} />
          ) : null}
          {/* Photos only: a stalled iCloud fetch shows "Accessing…" then a Retry
              instead of sitting on a blank frame. Mirrors the feed card. With a
              blurred preview showing, the full-frame states become a compact pill
              over the photo (the blur IS a photo; the live request can still
              complete and dissolve the pill away). */}
          {!isVideo && !load.imageReady ? (
            !load.showing ? (
              stalled ? (
                <View style={styles.loading}>
                  <Text style={styles.loadingText}>
                    {load.storageFull ? 'iPhone storage is full' : 'Photo couldn’t load'}
                  </Text>
                  {load.storageFull ? (
                    <Text style={styles.loadingSubtext}>
                      Free up space to load iCloud photos
                    </Text>
                  ) : load.offline ? (
                    <Text style={styles.loadingSubtext}>
                      You’re offline. Connect to load iCloud photos
                    </Text>
                  ) : null}
                  <Pressable onPress={load.retry} hitSlop={12} style={styles.retryButton}>
                    <Text style={styles.retryLabel}>Retry</Text>
                  </Pressable>
                </View>
              ) : load.accessing ? (
                <View style={styles.loading} pointerEvents="none">
                  <ActivityIndicator color={Ink} />
                  <Text style={styles.loadingText}>{accessingLabel}</Text>
                </View>
              ) : null
            ) : stalled ? (
              <Pressable onPress={load.retry} hitSlop={12} style={styles.pill}>
                <Text style={styles.pillText}>Retry</Text>
              </Pressable>
            ) : load.accessing ? (
              <View style={styles.pill} pointerEvents="none">
                <Text style={styles.pillText}>{accessingLabel}</Text>
              </View>
            ) : null
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
        // Thumbs never compete with the page image for the load queue.
        priority="low"
        transition={0}
        // No recyclingKey: filmstrip thumbs mount/unmount (windowed FlatList,
        // no view recycling), so it would only add the reset-to-blank flash.
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
  // Recovery overlay over the photo frame (Ink on the Paper canvas), mirroring the
  // feed card's loading/retry but themed for the viewer's white background.
  loading: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    marginTop: 14,
    fontFamily: DisplayFont,
    color: Ink,
    fontSize: 12,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  // Second line under the storage-full title; quieter than the title.
  loadingSubtext: {
    marginTop: 6,
    fontFamily: DisplayFont,
    color: Ink,
    opacity: 0.65,
    fontSize: 10,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    textAlign: 'center',
    paddingHorizontal: 24,
  },
  retryButton: {
    marginTop: 16,
    borderWidth: 2,
    borderColor: Ink,
    paddingHorizontal: 18,
    paddingVertical: 8,
  },
  retryLabel: {
    fontFamily: DisplayFont,
    color: Ink,
    fontSize: 12,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  // Compact hint/Retry pill shown over the blurred preview (bottom-center of the
  // frame) while the full image is still downloading or has stalled. Dark scrim
  // + Paper text: it sits on the photo, not the white canvas.
  pill: {
    position: 'absolute',
    bottom: 14,
    alignSelf: 'center',
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  pillText: {
    fontFamily: DisplayFont,
    color: Paper,
    fontSize: 11,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  pageFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  fallbackText: {
    fontFamily: DisplayFont,
    color: Paper,
    fontSize: 14,
    textTransform: 'uppercase',
    textAlign: 'center',
    paddingHorizontal: 24,
  },
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
  // Left cluster of the story bar: recreate + share; the X stays isolated on
  // the right so close is never next to an action.
  storyActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
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
  // Right-side top-bar group: recreate (photos only) + share.
  topActions: {
    flexDirection: 'row',
    alignItems: 'flex-start',
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
    // Spacing comes from thumbWrap's marginRight (not `gap`) so the FlatList's
    // fixed-stride getItemLayout math stays exact.
    paddingHorizontal: FILMSTRIP_PAD_H,
    paddingTop: 8,
    paddingBottom: 16,
  },
  thumbWrap: {
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    marginRight: THUMB_GAP,
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
