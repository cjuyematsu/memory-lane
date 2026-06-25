import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type ViewToken,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { Image } from 'expo-image';
import { Asset, MediaType } from 'expo-media-library';

import ShareIcon from '@/assets/icons/share.svg';
import ShuffleIcon from '@/assets/icons/shuffle.svg';
import { LoadingPolaroid } from '@/components/brand/loading-polaroid';
import { FeedCard } from '@/components/feed/feed-card';
import { FeedCardEventsContext, type FeedCardEvents } from '@/components/feed/feed-context';
import { PhotoFrame, frameLayout, type FrameLayout } from '@/components/feed/photo-frame';
import { DisplayFont, Ink, Paper } from '@/constants/theme';
import { useAssetFeed } from '@/hooks/use-asset-feed';
import {
  getCachedIsInCloud,
  getCachedMetadata,
  hydrateAsset,
  loadAssetIsInCloud,
} from '@/hooks/use-asset-metadata';
import { useMediaPermission } from '@/hooks/use-media-permission';
import { prefetchReverseGeocode } from '@/hooks/use-reverse-geocode';
import { requestShare } from '@/lib/share-memory';

let rememberedAssetId: string | null = null;
// Old-memory trickle: the on-device pick bias keeps shuffle instant but skews
// recent (iOS keeps recent photos local), so each session we quietly fetch a
// few photos sampled from the OLDER two-thirds of the library and feed them
// into the rotation. Module-level so the caps are truly per-session, not
// per-mount. Local old photos found while sampling join the pool for free.
let oldMemoryPool: string[] = [];
let oldMemoriesDownloaded = 0;
let oldMemoryTries = 0;
const OLD_MEMORY_SESSION_CAP = 6;
const OLD_MEMORY_TRY_CAP = 24;
// Six pre-decoded destinations so a burst of rapid shuffles stays on warm
// targets (four drained in under two seconds of tapping).
const SHUFFLE_QUEUE_SIZE = 6;
const CROSSFADE_DURATION_MS = 180;
// Card-ready now means the image truly rendered (load/error), so this only
// fires for hung loads (e.g. stalled iCloud downloads). Until then the
// overlay holds the previous photo — better than revealing a bare frame.
const CARD_READY_TIMEOUT_MS = 3000;
const OVERLAY_READY_TIMEOUT_MS = 350;
// Re-enables the shuffle button even if the destination never renders; must
// outlast CARD_READY_TIMEOUT + fade so the gate serializes the whole reveal.
const TRANSITION_RELEASE_CAP_MS = 4000;
// Stable empty list so a not-ready feed doesn't change `assets` identity
// every render (which would churn every assets-dependent hook below).
const NO_ASSETS: Asset[] = [];
// Module-level so FlatList sees a stable viewabilityConfig identity.
const VIEWABILITY_CONFIG = { itemVisiblePercentThreshold: 60 };
// Vertical space below the frame for the caption + shuffle button (+ safe-area
// inset, added separately). The frame is sized to leave this much room, so on
// phones it stays the full-width box and on iPad it shrinks to keep the caption
// and shuffle on screen.
const FEED_BOTTOM_RESERVE = 130;

// Metadata only — deliberately no Image.prefetch. For ph:// (and content://)
// photo-library URIs, prefetch decodes the FULL-resolution asset (expo-image's
// PhotoLibraryAssetLoader has no view-size context on the prefetch path, so it
// requests PHImageManagerMaximumSize — for iCloud-optimized libraries that
// downloads the original) and stores it under a cache key the card's render
// never reads (the view looks up url+thumbnail-size, prefetch stores the
// plain-url "original" layer). So prefetch here warmed nothing while its
// decodes competed with the visible card's own load. Real image warming is the
// hidden warm layer below, which renders at the card's exact size and thus
// populates the exact cache entry the card will hit.
function warmAssetMetadata(asset: Asset) {
  hydrateAsset(asset)
    .then((meta) => {
      if (meta?.location) prefetchReverseGeocode(meta.location);
    })
    .catch(() => {});
}

// The framed photo used by the splash (memory-feed entry) and the shuffle
// crossfade. Tracks its own landscape flag so it letterboxes the same way the
// live card does; shares the live card's frame geometry so nothing shifts on
// handoff.
function OverlayFramedPhoto({
  uri,
  frame,
  onReady,
}: {
  uri: string;
  frame: FrameLayout;
  // `ok` distinguishes a real paint from a load failure — overlay callers
  // proceed either way, but warm/download callers must not treat a failed
  // photo as cached.
  onReady?: (ok: boolean) => void;
}) {
  const [isLandscape, setIsLandscape] = useState(false);
  return (
    <PhotoFrame top={frame.top} left={frame.left} width={frame.width} height={frame.height}>
      <Image
        source={{ uri }}
        style={StyleSheet.absoluteFill}
        contentFit={isLandscape ? 'contain' : 'cover'}
        cachePolicy="memory-disk"
        transition={0}
        onLoad={(e) => {
          const { width: w, height: h } = e.source ?? {};
          if (w && h) setIsLandscape(w > h);
          onReady?.(true);
        }}
        onError={() => onReady?.(false)}
      />
    </PhotoFrame>
  );
}

export function Feed({
  startAssetId,
  rememberLastPosition = true,
  showShuffle = true,
  isActive = true,
  onZoomChange,
}: {
  startAssetId?: string | null;
  rememberLastPosition?: boolean;
  showShuffle?: boolean;
  isActive?: boolean;
  // Bubbles pinch-zoom active/inactive up to TopTabs, which gates the tab-swipe
  // and memory-overlay pans off while a two-finger zoom is in progress.
  onZoomChange?: (active: boolean) => void;
} = {}) {
  const [permission, requestPermission] = useMediaPermission();
  const granted = !!permission?.granted;
  const { state, reload } = useAssetFeed(granted);
  const window = useWindowDimensions();
  const insets = useSafeAreaInsets();

  const [layout, setLayout] = useState({ width: window.width, height: window.height });
  const [layoutMeasured, setLayoutMeasured] = useState(false);
  const [entryIndex, setEntryIndex] = useState<number | null>(null);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [outgoingAssetId, setOutgoingAssetId] = useState<string | null>(null);
  const [overlayPainted, setOverlayPainted] = useState(false);
  const [splashLatched, setSplashLatched] = useState(true);
  // Disables the feed's own vertical paging while a card is being pinch-zoomed
  // (and reports it up via onZoomChange so TopTabs can disable tab-swiping too).
  const [zooming, setZooming] = useState(false);
  const handleZoom = useCallback(
    (active: boolean) => {
      setZooming(active);
      onZoomChange?.(active);
    },
    [onZoomChange]
  );
  const listRef = useRef<FlatList<Asset>>(null);
  const fadeOpacity = useSharedValue(0);
  const cardReadyHandlerRef = useRef<(assetId: string) => void>(() => {});
  const pendingShuffleRef = useRef<{ pickedId: string; newIdx: number } | null>(
    null
  );
  // Pre-picked shuffle destinations. The ref is the source of truth for picks;
  // warmIds mirrors it into the hidden warm layer, which decodes each queued
  // photo at the card's exact frame size so a shuffle lands on a cache hit.
  const shuffleQueueRef = useRef<string[]>([]);
  const [warmIds, setWarmIds] = useState<string[]>([]);
  // The old memory currently downloading via a hidden frame-sized render
  // (null = none). State so the warm layer mounts/unmounts the view.
  const [downloadingOldId, setDownloadingOldId] = useState<string | null>(null);
  // Queue entries whose hidden warm render has finished decoding — shuffle
  // prefers these so rapid presses land on cache hits, not in-flight loads.
  const warmLoadedRef = useRef<Set<string>>(new Set());
  // Whether the queue holds anything renderable right now (decoded, or
  // confirmed on-device). The shuffle button stays dimmed without one, so a
  // press can never land on a photo that needs a download first.
  const [hasPickableTarget, setHasPickableTarget] = useState(false);
  // One transition at a time: busy from staging a crossfade until BOTH the
  // fade finished and the destination card reported rendered — fade-end alone
  // isn't enough, since the 1500ms timeout forces the fade even when the
  // photo hasn't decoded, and releasing there let bursts of presses chain
  // loads on top of an unfinished one. The shuffle button is disabled (and
  // dimmed) for the same window, so presses can't stack.
  const shuffleBusyRef = useRef(false);
  const refillInFlightRef = useRef(false);
  const transitionTargetRef = useRef<string | null>(null);
  const transitionFadeDoneRef = useRef(false);
  const transitionRenderedRef = useRef(false);
  const [transitionActive, setTransitionActive] = useState(false);

  // The splash backdrop is only used for the memory-feed flow, where the
  // incoming startAssetId is guaranteed to be the destination photo. The
  // main feed (rememberLastPosition === true) has no splash because there
  // is no way to know in advance which photo the entry effect will pick,
  // so persisting one and replaying it on next launch can show the wrong
  // image before the actual entry.
  const splash = useMemo<{ uri: string } | null>(() => {
    if (rememberLastPosition) return null;
    if (!startAssetId) return null;
    if (Platform.OS === 'ios') return { uri: startAssetId };
    const cachedMeta = getCachedMetadata(startAssetId);
    return cachedMeta?.uri ? { uri: cachedMeta.uri } : null;
  }, [rememberLastPosition, startAssetId]);

  const releaseTransition = useCallback(() => {
    transitionTargetRef.current = null;
    shuffleBusyRef.current = false;
    setTransitionActive(false);
  }, []);

  const cardEvents = useMemo<FeedCardEvents>(
    () => ({
      onCardReady: (assetId: string) => {
        cardReadyHandlerRef.current(assetId);
        setSplashLatched(false);
        // The shuffle gate listens here directly (not via the fade handler,
        // which is cleared once the fade starts) so a photo that renders
        // after the timeout-forced fade still re-enables the button.
        if (assetId === transitionTargetRef.current) {
          transitionRenderedRef.current = true;
          if (transitionFadeDoneRef.current) releaseTransition();
        }
      },
    }),
    [releaseTransition]
  );

  const overlayStyle = useAnimatedStyle(() => ({
    opacity: fadeOpacity.value,
  }));

  const finishCrossfade = useCallback(() => {
    setOutgoingAssetId(null);
    setOverlayPainted(false);
    transitionFadeDoneRef.current = true;
    if (transitionRenderedRef.current) releaseTransition();
  }, [releaseTransition]);

  // Shared frame geometry for the live card, the crossfade/splash overlays, and
  // the shuffle button, so all three line up and scale together on any screen.
  const frame = useMemo(
    () =>
      frameLayout(layout.width, layout.height, insets.top, insets.bottom, FEED_BOTTOM_RESERVE),
    [layout.width, layout.height, insets.top, insets.bottom]
  );

  const assets = useMemo(
    () => (state.status === 'ready' ? state.assets : NO_ASSETS),
    [state]
  );

  // Async (one in flight at a time): each candidate is checked against
  // iCloud before admission. On-device photos enter freely; at most ONE
  // not-yet-downloaded iCloud photo may occupy the queue at a time — its warm
  // render downloads it in the background, and the pick preference below
  // won't land on it until that finishes. This is what keeps a burst of
  // shuffles from ever waiting on the network: cloud photos rotate in only
  // once their bytes are here.
  const refillShuffleQueue = useCallback(
    async (alsoExclude?: string | null) => {
      if (!isActive || assets.length === 0) return;
      if (refillInFlightRef.current) return;
      if (shuffleQueueRef.current.length >= SHUFFLE_QUEUE_SIZE) return;
      refillInFlightRef.current = true;
      try {
        const exclude = new Set<string>(shuffleQueueRef.current);
        if (currentId) exclude.add(currentId);
        if (alsoExclude) exclude.add(alsoExclude);
        // Pending (un-downloaded) cloud entries already queued count against
        // the cap, so stuck downloads can't accumulate across refills.
        let pendingCloud = shuffleQueueRef.current.filter(
          (id) => getCachedIsInCloud(id) === true && !warmLoadedRef.current.has(id)
        ).length;
        let added = false;
        // Inject ONE pre-fetched old memory per refill, ahead of the random
        // sampling, so the rotation keeps mixing in older photos.
        while (oldMemoryPool.length > 0) {
          const id = oldMemoryPool.shift()!;
          if (exclude.has(id) || !assets.some((a) => a.id === id)) continue;
          exclude.add(id);
          const asset = assets.find((a) => a.id === id)!;
          warmAssetMetadata(asset);
          shuffleQueueRef.current.push(id);
          added = true;
          break;
        }
        // Re-read the ref each iteration: a shuffle can swap the queue array
        // while we're awaiting a cloud check.
        for (let i = 0; i < 30 && shuffleQueueRef.current.length < SHUFFLE_QUEUE_SIZE; i++) {
          const candidate = assets[Math.floor(Math.random() * assets.length)];
          if (exclude.has(candidate.id)) continue;
          exclude.add(candidate.id);
          const inCloud = await loadAssetIsInCloud(candidate);
          if (inCloud) {
            if (pendingCloud >= 1) continue;
            pendingCloud += 1;
          }
          warmAssetMetadata(candidate);
          shuffleQueueRef.current.push(candidate.id);
          added = true;
        }
        if (!added) return;
        const queue = shuffleQueueRef.current;
        // Drop loaded-marks for ids no longer queued so the set tracks only
        // the mounted warm layer.
        for (const id of warmLoadedRef.current) {
          if (!queue.includes(id)) warmLoadedRef.current.delete(id);
        }
        setWarmIds([...queue]);
      } finally {
        refillInFlightRef.current = false;
      }
    },
    [assets, currentId, isActive]
  );

  // Sample the older two-thirds of the (newest-first) library for the next
  // old memory to fetch. Already-local old photos join the pool immediately —
  // free variety — and only an iCloud-resident one is returned for download.
  const pickOldCloudCandidate = useCallback(async (): Promise<string | null> => {
    const start = Math.floor(assets.length / 3);
    if (start >= assets.length) return null;
    for (let i = 0; i < 8 && oldMemoryTries < OLD_MEMORY_TRY_CAP; i++) {
      oldMemoryTries += 1;
      const idx = start + Math.floor(Math.random() * (assets.length - start));
      const a = assets[idx];
      if (!a || a.id === currentId) continue;
      if (oldMemoryPool.includes(a.id) || shuffleQueueRef.current.includes(a.id)) continue;
      const inCloud = await loadAssetIsInCloud(a);
      if (inCloud) return a.id;
      oldMemoryPool.push(a.id);
    }
    return null;
  }, [assets, currentId]);

  // Drive the old-memory downloads: one at a time, only while the main feed
  // is idle (no transition in flight), capped per session. Each completed
  // transition re-runs this, giving a natural pacing tied to actual use.
  useEffect(() => {
    if (!rememberLastPosition || !isActive || entryIndex === null) return;
    if (transitionActive || outgoingAssetId || downloadingOldId) return;
    if (oldMemoriesDownloaded >= OLD_MEMORY_SESSION_CAP) return;
    if (oldMemoryTries >= OLD_MEMORY_TRY_CAP) return;
    let cancelled = false;
    (async () => {
      const id = await pickOldCloudCandidate();
      if (!cancelled && id) setDownloadingOldId(id);
    })();
    return () => {
      cancelled = true;
    };
  }, [
    rememberLastPosition,
    isActive,
    entryIndex,
    transitionActive,
    outgoingAssetId,
    downloadingOldId,
    pickOldCloudCandidate,
  ]);

  const prefetchAround = useCallback(
    (idx: number) => {
      if (!isActive) return;
      // Neighbor cards' images are already mounted (and decoding) via the
      // FlatList window; only their caption metadata needs warming.
      for (const d of [-2, -1, 1, 2]) {
        const a = assets[idx + d];
        if (a) warmAssetMetadata(a);
      }
    },
    [assets, isActive]
  );

  useEffect(() => {
    if (state.status === 'ready' && entryIndex === null && assets.length > 0) {
      const commit = (idx: number) => {
        const chosen = assets[idx];
        setEntryIndex(idx);
        setCurrentId(chosen.id);
        if (rememberLastPosition) rememberedAssetId = chosen.id;
        warmAssetMetadata(chosen);
        prefetchAround(idx);
        refillShuffleQueue(chosen.id);
      };
      if (startAssetId) {
        const idx = assets.findIndex((a) => a.id === startAssetId);
        if (idx >= 0) {
          commit(idx);
          return;
        }
      }
      if (rememberLastPosition && rememberedAssetId) {
        const idx = assets.findIndex((a) => a.id === rememberedAssetId);
        if (idx >= 0) {
          commit(idx);
          return;
        }
      }
      // Random entry: scan a few candidates for one that's on device, so a
      // fresh launch doesn't open on an iCloud download spinner. The first
      // roll is the fallback if every candidate needs the network.
      let cancelled = false;
      (async () => {
        const fallbackIdx = Math.floor(Math.random() * assets.length);
        for (let i = 0; i < 8; i++) {
          const idx = i === 0 ? fallbackIdx : Math.floor(Math.random() * assets.length);
          const inCloud = await loadAssetIsInCloud(assets[idx]);
          if (cancelled) return;
          if (!inCloud) {
            commit(idx);
            return;
          }
        }
        commit(fallbackIdx);
      })();
      return () => {
        cancelled = true;
      };
    }
  }, [
    state,
    entryIndex,
    assets,
    prefetchAround,
    refillShuffleQueue,
    startAssetId,
    rememberLastPosition,
  ]);

  useEffect(() => {
    if (currentId && rememberLastPosition) rememberedAssetId = currentId;
  }, [currentId, rememberLastPosition]);

  // Safety net: if no card ever signals ready (e.g., the entry asset got
  // deleted), drop the splash latch after a couple seconds so the user
  // isn't stuck staring at a stale image.
  useEffect(() => {
    if (state.status !== 'ready' || entryIndex === null) return;
    const t = setTimeout(() => setSplashLatched(false), 2500);
    return () => clearTimeout(t);
  }, [state.status, entryIndex]);

  // Top the queue back up whenever the feed becomes active, the library
  // changes, or a shuffle lands (currentId change recreates the callback) —
  // but never while a crossfade is in flight, so the warm layer's decodes
  // can't compete with the destination photo's own load.
  useEffect(() => {
    if (isActive && !outgoingAssetId && !transitionActive) refillShuffleQueue();
  }, [isActive, outgoingAssetId, transitionActive, refillShuffleQueue]);

  const shuffle = useCallback(() => {
    if (assets.length === 0) return;
    // The button is disabled while a transition is active; this synchronous
    // guard only covers the gap before that disable commits (double-taps
    // within a frame). Overlapping crossfades corrupted the overlay state and
    // stacked enough photo loads to starve the visible one for many seconds.
    if (shuffleBusyRef.current) return;

    // Prefer a destination whose hidden warm render has finished decoding,
    // then any confirmed on-device entry — never an un-downloaded iCloud
    // photo while something renderable is available.
    const loaded = warmLoadedRef.current;
    const queue = shuffleQueueRef.current.filter(
      (id) => id !== currentId && assets.some((a) => a.id === id)
    );
    let pickedId =
      queue.find((id) => loaded.has(id)) ??
      queue.find((id) => getCachedIsInCloud(id) === false) ??
      queue[0];
    if (pickedId) queue.splice(queue.indexOf(pickedId), 1);
    shuffleQueueRef.current = queue;

    if (!pickedId) {
      // Cold path (empty/stale queue): pick fresh, skipping the current photo
      // so a shuffle always visibly changes something. Stage immediately — the
      // overlay's paint gating already hides the decode, and waiting on a
      // prefetch here only delayed it.
      let idx = Math.floor(Math.random() * assets.length);
      if (assets.length > 1 && assets[idx].id === currentId) {
        idx = (idx + 1) % assets.length;
      }
      pickedId = assets[idx].id;
    }
    // Refill happens via the effect above once the crossfade settles, so the
    // replacement decodes never race the destination photo.

    const newIdx = assets.findIndex((a) => a.id === pickedId);
    if (newIdx < 0) return;

    const prevId = currentId;
    const willCrossfade = prevId != null && prevId !== pickedId;

    if (willCrossfade) {
      // Stage the destination but DON'T scroll yet. The overlay mounts
      // transparent over the (identical) current photo, so there's no black
      // photo-frame flash while its image decodes. Once the overlay image
      // actually paints (onReady -> overlayPainted), the effect below snaps
      // it opaque, scrolls the list underneath, then crossfades to the new
      // card. Gating on the real paint — not a bare RAF after commit — is
      // what stops the list swap from leaking through.
      shuffleBusyRef.current = true;
      transitionTargetRef.current = pickedId;
      transitionFadeDoneRef.current = false;
      transitionRenderedRef.current = false;
      setTransitionActive(true);
      pendingShuffleRef.current = { pickedId, newIdx };
      setOverlayPainted(false);
      fadeOpacity.value = 0;
      setOutgoingAssetId(prevId);
      return;
    }

    // No crossfade needed (no prior current, or same target): direct commit.
    setCurrentId(pickedId);
    if (rememberLastPosition) rememberedAssetId = pickedId;
    listRef.current?.scrollToIndex({ index: newIdx, animated: false });
  }, [assets, currentId, fadeOpacity, rememberLastPosition]);

  // Open the share chooser for the photo on screen. The mediaType is read from
  // the warmed metadata cache (the visible card has already loaded its caption,
  // so it's present); default to photo if somehow not yet cached.
  const handleShare = useCallback(() => {
    if (!currentId) return;
    const asset = assets.find((a) => a.id === currentId);
    if (!asset) return;
    const cached = getCachedMetadata(currentId);
    requestShare(asset, cached?.mediaType === MediaType.VIDEO);
  }, [assets, currentId]);

  // Hard cap on the disabled window: if the destination card never reports
  // rendered (hung load, or the library reloaded mid-transition and the
  // scroll landed on a different card), re-enable shuffle anyway.
  useEffect(() => {
    if (!transitionActive) return;
    const t = setTimeout(releaseTransition, TRANSITION_RELEASE_CAP_MS);
    return () => clearTimeout(t);
  }, [transitionActive, releaseTransition]);

  // Drive the crossfade only once the overlay's image has actually painted
  // (overlayPainted, set from the overlay Image's onLoad/onError or the
  // safety timeout below). Snap the overlay opaque, then over the next two
  // frames scroll the list to the new photo while it's hidden and wire up the
  // card-ready handler that drives the fade-out. Gating on the real paint —
  // not a bare RAF after commit — is what keeps the list swap from flashing
  // through, and starting transparent avoids the black photo-frame flash.
  useEffect(() => {
    if (!outgoingAssetId || !overlayPainted) return;
    const pending = pendingShuffleRef.current;
    if (!pending) return;
    pendingShuffleRef.current = null;

    fadeOpacity.value = 1;

    let timer: ReturnType<typeof setTimeout> | null = null;
    let innerRaf = 0;
    // Two frames so the opacity snap is on screen before the list moves;
    // otherwise the scroll could land a frame ahead of the cover.
    const outerRaf = requestAnimationFrame(() => {
      innerRaf = requestAnimationFrame(() => {
        setCurrentId(pending.pickedId);
        if (rememberLastPosition) rememberedAssetId = pending.pickedId;
        listRef.current?.scrollToIndex({ index: pending.newIdx, animated: false });

        let fired = false;
        const startFadeOut = () => {
          if (fired) return;
          fired = true;
          cardReadyHandlerRef.current = () => {};
          fadeOpacity.value = withTiming(
            0,
            { duration: CROSSFADE_DURATION_MS, easing: Easing.out(Easing.cubic) },
            () => {
              'worklet';
              // Run even when the animation reports cancelled: transitions are
              // serialized on shuffleBusyRef, and skipping this would leave
              // the latch stuck and shuffle dead until remount.
              scheduleOnRN(finishCrossfade);
            }
          );
        };
        cardReadyHandlerRef.current = (readyId) => {
          if (readyId === pending.pickedId) startFadeOut();
        };
        timer = setTimeout(startFadeOut, CARD_READY_TIMEOUT_MS);
      });
    });

    return () => {
      cancelAnimationFrame(outerRaf);
      cancelAnimationFrame(innerRaf);
      if (timer) clearTimeout(timer);
    };
  }, [outgoingAssetId, overlayPainted, rememberLastPosition, fadeOpacity, finishCrossfade]);

  // Safety net: if the overlay image never reports ready (slow/failed load),
  // force the crossfade forward after a beat so a shuffle can't hang with an
  // invisible overlay and a list that never scrolls.
  useEffect(() => {
    if (!outgoingAssetId || overlayPainted) return;
    const t = setTimeout(() => setOverlayPainted(true), OVERLAY_READY_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [outgoingAssetId, overlayPainted]);

  useEffect(() => {
    if (!currentId || assets.length === 0) return;
    const idx = assets.findIndex((a) => a.id === currentId);
    if (idx >= 0) prefetchAround(idx);
  }, [currentId, assets, prefetchAround]);

  const getItemLayout = useCallback(
    (_: ArrayLike<Asset> | null | undefined, index: number) => ({
      length: layout.height,
      offset: layout.height * index,
      index,
    }),
    [layout.height]
  );

  // FlatList requires both of these to keep a stable identity across renders;
  // an empty-deps useCallback and a module-style constant satisfy that without
  // reading refs during render.
  const onViewableItemsChanged = useCallback(
    ({ viewableItems }: { viewableItems: ViewToken<Asset>[] }) => {
      const first = viewableItems[0];
      if (first?.item) {
        setCurrentId(first.item.id);
      }
    },
    []
  );

  if (!permission) {
    return <LoadingPolaroid />;
  }

  if (!permission.granted) {
    // Once denied, requestPermission() is a silent no-op — send them to Settings.
    const canAsk = permission.canAskAgain;
    return (
      <SafeAreaView style={styles.center}>
        <Text style={styles.title}>PastPic</Text>
        <Text style={styles.body}>We need access to your photos.</Text>
        <Pressable
          style={styles.button}
          onPress={() => (canAsk ? requestPermission() : Linking.openSettings())}>
          <Text style={styles.buttonLabel}>{canAsk ? 'Grant access' : 'Open Settings'}</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  const isReady =
    state.status === 'ready' && state.assets.length > 0 && entryIndex !== null;
  const isError = state.status === 'error';
  const isEmpty = state.status === 'ready' && state.assets.length === 0;
  const isLoading = !isReady && !isError && !isEmpty;

  return (
    <View
      style={styles.container}
      onLayout={(e) => {
        const next = e.nativeEvent.layout;
        if (next.height !== layout.height || next.width !== layout.width) {
          setLayout({ width: next.width, height: next.height });
        }
        if (!layoutMeasured) setLayoutMeasured(true);
      }}>
      {splash && splashLatched && (isLoading || isReady) ? (
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          <OverlayFramedPhoto uri={splash.uri} frame={frame} />
        </View>
      ) : null}

      {isLoading && (!splash || !splashLatched) ? (
        <View style={StyleSheet.absoluteFill}>
          <LoadingPolaroid />
        </View>
      ) : null}

      {isError && state.status === 'error' ? (
        <SafeAreaView style={styles.center}>
          <Text style={styles.body}>{state.message}</Text>
          <Pressable style={styles.button} onPress={() => reload()}>
            <Text style={styles.buttonLabel}>Retry</Text>
          </Pressable>
        </SafeAreaView>
      ) : null}

      {isEmpty ? (
        <SafeAreaView style={styles.center}>
          <Text style={styles.body}>No photos.</Text>
        </SafeAreaView>
      ) : null}

      {isReady && entryIndex !== null && layoutMeasured ? (
        <FeedCardEventsContext.Provider value={cardEvents}>
          {/* Clip the pager to below the navbar/band so a paging swipe never
              slides a photo up behind the header — matches Near Me, which is
              inset below the same `frame.top` line. The double-View keeps the
              list in full-screen coordinates (frame math + paging unchanged):
              the inner View is shifted up by frame.top so the list still lays
              out from screen 0, while the outer overflow:hidden trims anything
              above frame.top. */}
          <View style={[styles.pagerClip, { top: frame.top }]}>
            <View style={[styles.pagerInner, { top: -frame.top, height: layout.height }]}>
              <FlatList
                ref={listRef}
                style={StyleSheet.absoluteFill}
                data={assets}
                keyExtractor={(item) => item.id}
                renderItem={({ item }) => (
                  <FeedCard
                    asset={item}
                    isCurrent={item.id === currentId}
                    isActive={isActive}
                    width={layout.width}
                    height={layout.height}
                    frame={frame}
                    onZoomChange={handleZoom}
                  />
                )}
                scrollEnabled={!zooming}
                pagingEnabled
                snapToInterval={layout.height}
                snapToAlignment="start"
                disableIntervalMomentum
                showsVerticalScrollIndicator={false}
                initialScrollIndex={entryIndex}
                getItemLayout={getItemLayout}
                decelerationRate="fast"
                windowSize={5}
                initialNumToRender={1}
                maxToRenderPerBatch={3}
                removeClippedSubviews
                onViewableItemsChanged={onViewableItemsChanged}
                viewabilityConfig={VIEWABILITY_CONFIG}
                extraData={`${currentId}|${isActive}`}
              />
            </View>
          </View>
        </FeedCardEventsContext.Provider>
      ) : null}

      {outgoingAssetId ? (
        <Animated.View style={[styles.crossfadeOverlay, overlayStyle]} pointerEvents="none">
          <OverlayFramedPhoto
            uri={outgoingAssetId}
            frame={frame}
            onReady={() => setOverlayPainted(true)}
          />
        </Animated.View>
      ) : null}

      {/* Hidden warm layer: decodes queued shuffle destinations at the card's
          exact frame size, so their cache entries are the ones the destination
          card reads (the cache key includes the view's pixel size — a plain
          prefetch can't populate it). Invisible and non-interactive. */}
      {isReady && (warmIds.length > 0 || downloadingOldId) ? (
        <View style={styles.warmLayer} pointerEvents="none">
          {warmIds.map((id) => (
            <OverlayFramedPhoto
              key={id}
              uri={id}
              frame={frame}
              onReady={(ok) => {
                if (ok) warmLoadedRef.current.add(id);
              }}
            />
          ))}
          {downloadingOldId ? (
            <OverlayFramedPhoto
              key={`old-${downloadingOldId}`}
              uri={downloadingOldId}
              frame={frame}
              onReady={(ok) => {
                if (ok) {
                  oldMemoryPool.push(downloadingOldId);
                  oldMemoriesDownloaded += 1;
                }
                setDownloadingOldId(null);
              }}
            />
          ) : null}
        </View>
      ) : null}

      {isReady && currentId ? (
        <View
          style={[styles.shareWrapper, { top: frame.top + frame.height + 80 }]}
          pointerEvents="box-none">
          <Pressable style={styles.shuffle} onPress={handleShare} hitSlop={12}>
            <ShareIcon width={28} height={28} color={Ink} />
          </Pressable>
        </View>
      ) : null}

      {isReady && showShuffle ? (
        <View
          style={[
            styles.shuffleWrapper,
            // Centered in the empty band between the caption and the screen
            // bottom (frame bottom + the ~caption block height).
            { top: frame.top + frame.height + 80 },
          ]}
          pointerEvents="box-none">
          <Pressable
            style={[styles.shuffle, transitionActive && styles.shuffleBusy]}
            onPress={shuffle}
            disabled={transitionActive}
            hitSlop={12}>
            <ShuffleIcon width={26} height={26} color={Ink} />
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Paper,
  },
  // Clip region for the pager: starts at the band line (`top: frame.top`, set
  // inline) and runs to the bottom, hiding anything that scrolls above it.
  pagerClip: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    overflow: 'hidden',
  },
  // Counter-shifted up by frame.top (set inline) so the FlatList still lays out
  // from screen 0 — paging height and the card's frame math are unchanged.
  pagerInner: {
    position: 'absolute',
    left: 0,
    right: 0,
  },
  center: {
    flex: 1,
    backgroundColor: Paper,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    paddingHorizontal: 24,
  },
  title: {
    fontFamily: DisplayFont,
    fontSize: 40,
    color: Ink,
    textTransform: 'uppercase',
  },
  body: {
    fontFamily: DisplayFont,
    color: Ink,
    fontSize: 16,
    textAlign: 'center',
  },
  button: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 32,
    backgroundColor: Ink,
  },
  buttonLabel: {
    fontFamily: DisplayFont,
    color: Paper,
    fontWeight: '700',
  },
  shuffleWrapper: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    // vertically centered in the band below the caption (top set inline),
    // horizontally on the right where it was
    alignItems: 'flex-end',
    justifyContent: 'center',
    paddingRight: 24,
  },
  // Mirror of the shuffle wrapper on the left, vertically aligned with it.
  shareWrapper: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'flex-start',
    justifyContent: 'center',
    paddingLeft: 24,
  },
  shuffle: {
    padding: 8,
  },
  // Disabled-while-transitioning; on warm shuffles the dim lasts ~300ms and
  // reads as press feedback rather than a state change.
  shuffleBusy: {
    opacity: 0.35,
  },
  warmLayer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    opacity: 0,
  },
  // Full-screen white behind the dissolving framed photo so the card swap is hidden.
  crossfadeOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: Paper,
  },
});
