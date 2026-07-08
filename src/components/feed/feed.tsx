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

import CameraIcon from '@/assets/icons/camera.svg';
import ShareIcon from '@/assets/icons/share.svg';
import ShuffleIcon from '@/assets/icons/shuffle.svg';
import { LoadingPolaroid } from '@/components/brand/loading-polaroid';
import { ErrorBoundary } from '@/components/error-boundary';
import { FeedCard } from '@/components/feed/feed-card';
import { FeedCardEventsContext, type FeedCardEvents } from '@/components/feed/feed-context';
import {
  FEED_BOTTOM_RESERVE,
  PhotoFrame,
  frameLayout,
  type FrameLayout,
} from '@/components/feed/photo-frame';
import { DisplayFont, Ink, Paper } from '@/constants/theme';
import { useAssetFeed } from '@/hooks/use-asset-feed';
import {
  getCachedIsInCloud,
  getCachedMetadata,
  hydrateAsset,
  loadAssetIsInCloud,
  loadAssetMediaType,
  useAssetMetadata,
} from '@/hooks/use-asset-metadata';
import { useMediaPermission } from '@/hooks/use-media-permission';
import { prefetchReverseGeocode } from '@/hooks/use-reverse-geocode';
import { getAssetRatio, setAssetRatio } from '@/lib/asset-ratio-cache';
import { nextOnDeviceIndex } from '@/lib/feed-on-device';
import { entryCandidateOrder } from '@/lib/feed-entry';
import { pendingWarmDownload, planWarmMounts, type WarmEntry } from '@/lib/feed-warm-plan';
import { isPlaceholderLoad } from '@/lib/image-load-event';
import { withTimeoutDefault } from '@/lib/async-safety';
import {
  ENTRY_SELECT_DEADLINE_MS,
  FIND_ON_DEVICE_SCAN_MS,
  OLD_MEMORY_DOWNLOAD_CAP_MS,
  WARM_FAILURE_PAUSE_MS,
  WARM_PENDING_DOWNLOAD_MS,
} from '@/lib/loading-timeouts';
import { getWarmedEntryId } from '@/lib/feed-entry-warm';
import { cardLoadPriority } from '@/lib/feed-priority';
import { markFirstPaint } from '@/lib/first-paint';
import { requestRecreation } from '@/lib/recreation-request';
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
  priority = 'normal',
}: {
  uri: string;
  frame: FrameLayout;
  // `ok` distinguishes a real paint from a load failure; `final` distinguishes
  // the full image from the degraded blurred placeholder the patched
  // opportunistic delivery paints first. Overlay callers proceed on any paint,
  // but warm/download callers must only count `ok && final` — the blur means
  // the bytes are NOT here yet (and it's never cached by SDWebImage), so
  // treating it as warm would put un-downloaded iCloud photos in the shuffle
  // rotation and un-serialize the background downloads.
  onReady?: (ok: boolean, final: boolean) => void;
  // Visible overlays (splash, crossfade) load at high priority; the hidden
  // warm-layer / old-memory decodes run at 'low' so they never outrank the
  // photo the user is actually looking at.
  priority?: 'low' | 'normal' | 'high';
}) {
  // Seed orientation from the shared ratio cache so the OUTGOING shuffle photo
  // (just shown by the live card, which records its ratio on load) opens in the
  // right fit immediately. Without this the overlay started `cover` and corrected
  // to `contain` for a landscape photo — the visible zoom on shuffle.
  const cachedRatio = getAssetRatio(uri);
  const [loadedLandscapeUri, setLoadedLandscapeUri] = useState<string | null>(null);
  const isLandscape =
    loadedLandscapeUri === uri || (cachedRatio !== undefined && cachedRatio > 1);
  return (
    <PhotoFrame top={frame.top} left={frame.left} width={frame.width} height={frame.height}>
      <Image
        source={{ uri }}
        style={StyleSheet.absoluteFill}
        contentFit={isLandscape ? 'contain' : 'cover'}
        cachePolicy="memory-disk"
        priority={priority}
        // Instant: the overlay shows an already-on-screen photo (a cache hit), so
        // it must appear at once. A `transition` here faded it in over the black
        // frame, which (with the cover→contain correction) read as the shuffle
        // zoom. The crossfade OUT to the new photo is the wrapping fadeOpacity,
        // not this prop.
        transition={0}
        onLoad={(e) => {
          const { width: w, height: h } = e.source ?? {};
          if (w && h) {
            setAssetRatio(uri, w / h);
            if (w > h) setLoadedLandscapeUri(uri);
          }
          onReady?.(true, !isPlaceholderLoad(e));
        }}
        onError={() => onReady?.(false, true)}
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
  // Flips true the first time a card actually paints. Gates the hidden warm
  // layer + old-memory downloads so they don't pile onto the Photos framework
  // while the very first photo is still loading (worst on an offloaded library).
  const [hasPaintedFirst, setHasPaintedFirst] = useState(false);
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
  // warmEntries mirrors it (with iCloud residency captured at admission time from
  // the refill probe — never read from module caches in render) into the hidden
  // warm layer, which decodes each queued photo at the card's exact frame size so
  // a shuffle lands on a cache hit.
  const shuffleQueueRef = useRef<string[]>([]);
  const [warmEntries, setWarmEntries] = useState<WarmEntry[]>([]);
  // Residency by queued id, written when the refill loop admits an entry (it has
  // the probe result in hand) and read only inside refill to build warmEntries.
  const queueCloudRef = useRef<Map<string, boolean>>(new Map());
  // The old memory currently downloading via a hidden frame-sized render
  // (null = none). State so the warm layer mounts/unmounts the view.
  const [downloadingOldId, setDownloadingOldId] = useState<string | null>(null);
  // Queue entries whose hidden warm render finished decoding the FINAL image
  // (bytes in the cache — a blurred preview doesn't count) — shuffle prefers
  // these so rapid presses land on cache hits, not in-flight downloads. State,
  // not a ref: planWarmMounts below must recompute (and mount the next pending
  // cloud download) when an entry completes.
  const [warmLoaded, setWarmLoaded] = useState<ReadonlySet<string>>(() => new Set());
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

  // "Find one on device" is invoked from a card (which can't reference
  // assets/listRef, defined below); route through a ref kept current by the
  // effect below, so cardEvents stays a stable memo.
  const findOnDeviceHandlerRef = useRef<(assetId: string) => Promise<boolean>>(
    async () => false
  );

  const cardEvents = useMemo<FeedCardEvents>(
    () => ({
      onCardReady: (assetId: string) => {
        // First real photo on screen: release the deferred cold index build
        // (use-nearby-assets waits on this) and the warm-layer gate below.
        markFirstPaint();
        setHasPaintedFirst(true);
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
      onFindOnDevice: (assetId: string) => findOnDeviceHandlerRef.current(assetId),
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

  // Index of the card in view, so renderItem can score each card's load
  // priority by its distance from it (current = high, ±2 = normal, rest = low).
  const currentIndex = useMemo(
    () => (currentId ? assets.findIndex((a) => a.id === currentId) : -1),
    [assets, currentId]
  );

  // Async (one in flight at a time): each candidate's iCloud residency is
  // probed before admission and captured on the entry. Cloud photos are
  // admitted freely (on a heavily offloaded library the old one-pending-cloud
  // admission gate starved the queue, pushing shuffles onto the cold path);
  // their DOWNLOADS are serialized instead by planWarmMounts, which mounts only
  // one not-yet-downloaded cloud entry at a time. The pick preference below
  // still never lands on an un-downloaded cloud photo while something
  // renderable is available.
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
        let added = false;
        // Inject ONE pre-fetched old memory per refill, ahead of the random
        // sampling, so the rotation keeps mixing in older photos. Pool ids were
        // all genuinely probed (that's how they entered the pool), so the
        // residency cache hits; a downloaded old memory still reads as in-cloud
        // there, which just routes it through the (instantly satisfied, the
        // bytes are cached) download slot.
        while (oldMemoryPool.length > 0) {
          const id = oldMemoryPool.shift()!;
          if (exclude.has(id) || !assets.some((a) => a.id === id)) continue;
          exclude.add(id);
          const asset = assets.find((a) => a.id === id)!;
          warmAssetMetadata(asset);
          queueCloudRef.current.set(id, getCachedIsInCloud(id) ?? false);
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
          // A timed-out probe answers `true` (pessimistic, uncached) — recorded
          // as-is so the entry waits its turn in the download slot.
          const inCloud = await loadAssetIsInCloud(candidate);
          warmAssetMetadata(candidate);
          queueCloudRef.current.set(candidate.id, inCloud);
          shuffleQueueRef.current.push(candidate.id);
          added = true;
        }
        if (!added) return;
        const queue = shuffleQueueRef.current;
        const queued = new Set(queue);
        // Drop residency records and loaded-marks for ids no longer queued so
        // both track only the live queue.
        for (const id of queueCloudRef.current.keys()) {
          if (!queued.has(id)) queueCloudRef.current.delete(id);
        }
        setWarmLoaded((prev) => {
          const kept = [...prev].filter((id) => queued.has(id));
          return kept.length === prev.size ? prev : new Set(kept);
        });
        setWarmEntries(
          queue.map((id) => ({ id, inCloud: queueCloudRef.current.get(id) ?? false }))
        );
      } finally {
        refillInFlightRef.current = false;
      }
    },
    [assets, currentId, isActive]
  );

  // A failed (or stalled, via the watchdog below) warm render is dropped from
  // the queue entirely so it can't hold the download slot or get picked as the
  // queue[0] last resort; the refill effect tops the queue back up.
  const dropWarmEntry = useCallback((id: string) => {
    shuffleQueueRef.current = shuffleQueueRef.current.filter((q) => q !== id);
    queueCloudRef.current.delete(id);
    setWarmEntries((prev) =>
      prev.some((e) => e.id === id) ? prev.filter((e) => e.id !== id) : prev
    );
  }, []);

  const markWarmLoaded = useCallback((id: string) => {
    setWarmLoaded((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
  }, []);

  // A FAILED warm download pauses the download slot: dropping the failed entry
  // triggers an immediate refill, so fast failures (offline, storage-full)
  // would otherwise loop mount→error→drop→refill against the Photos framework
  // all session. Renderable entries keep mounting; only the pending-download
  // slot waits out the pause.
  const [warmPausedUntil, setWarmPausedUntil] = useState(0);
  useEffect(() => {
    if (!warmPausedUntil) return;
    const t = setTimeout(
      () => setWarmPausedUntil(0),
      Math.max(0, warmPausedUntil - Date.now())
    );
    return () => clearTimeout(t);
  }, [warmPausedUntil]);
  const warmDownloadsPaused = warmPausedUntil !== 0;

  // What the hidden warm layer mounts right now — every renderable entry plus
  // at most ONE not-yet-downloaded cloud entry (download serialization lives
  // here, not at queue admission). Pure functions of state, so the plan
  // recomputes exactly when an entry completes or drops.
  const mountedWarmIds = planWarmMounts(warmEntries, warmLoaded, !warmDownloadsPaused);
  const pendingWarmId = warmDownloadsPaused
    ? null
    : pendingWarmDownload(warmEntries, warmLoaded);

  // Watchdog: a warm download that never completes (no load, no error) is
  // dropped so it can't pin the single download slot for the whole session.
  useEffect(() => {
    if (!pendingWarmId) return;
    const t = setTimeout(() => dropWarmEntry(pendingWarmId), WARM_PENDING_DOWNLOAD_MS);
    return () => clearTimeout(t);
  }, [pendingWarmId, dropWarmEntry]);

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
    // Hold background old-memory downloads until the first photo has painted, so
    // they don't compete with it for the network/decoder on cold start.
    if (!hasPaintedFirst) return;
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
    hasPaintedFirst,
    pickOldCloudCandidate,
  ]);

  // Watchdog for the old-memory slot: a hidden download that never reports
  // (stalled fetch) is cleared uncounted so the trickle isn't dead for the
  // session (oldMemoryTries was already incremented at pick time, so the
  // session caps still converge).
  useEffect(() => {
    if (!downloadingOldId) return;
    const t = setTimeout(() => setDownloadingOldId(null), OLD_MEMORY_DOWNLOAD_CAP_MS);
    return () => clearTimeout(t);
  }, [downloadingOldId]);

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
        // Warm-layer refill is deferred until the entry card paints (see the
        // hasPaintedFirst-gated effect below), so the queue's hidden decodes
        // don't compete with the very first photo's load.
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
      // Onboarding warmed an on-device entry (and the warm host pre-decoded it at
      // this exact frame size): open on it so the very first photo is a cache hit
      // — same "random on-device memory" UX as the probe below, just instant.
      if (rememberLastPosition) {
        const warmedId = getWarmedEntryId();
        if (warmedId) {
          const idx = assets.findIndex((a) => a.id === warmedId);
          if (idx >= 0) {
            commit(idx);
            return;
          }
        }
      }
      // Random entry: probe a purely random sample for a candidate that's on
      // device (instant sharp paint) and commit the first hit. Deliberately NO
      // newest-photos block here (recentN = 0): under Optimize iPhone Storage
      // only recent photos stay local, so the old newest-block fallback pinned
      // every cold launch to the most recent photo. When the whole sample is
      // iCloud-resident we open a random cloud photo instead and let the
      // blur→sharp opportunistic delivery cover the download. (The onboarding
      // prewarm keeps the newest block — it must find SOME on-device photo to
      // pre-decode, and the feed adopts its pick via getWarmedEntryId above.)
      let cancelled = false;
      let committed = false;
      const commitOnce = (idx: number) => {
        if (cancelled || committed) return;
        committed = true;
        commit(idx);
      };
      const order = entryCandidateOrder(assets.length, Math.random, 30, 0);
      // The DEADLINE fallback target: a RANDOM asset known to be a photo.
      // Blindly committing index 0 pinned every fallback launch to the SAME
      // newest asset (first the just-recorded video — the one entry the probe
      // itself can never pick, since videos read as in-cloud — and, made
      // deterministic-photo, still "the app always opens on this one"). A cheap
      // parallel media-type scan over the first few candidates of the already-
      // random order resolves while the residency probe below runs; the
      // earliest scanned photo wins, so the fallback inherits the order's
      // randomness. The residency probe dedupes these reads, so the scan is
      // effectively free. Newest asset remains the absolute last resort when
      // nothing resolved at all (an extremely cold Photos framework). The
      // exhausted-sample path below does its own full-order walk instead.
      let fallbackPos: number | null = null;
      (async () => {
        const scan = order.slice(0, Math.min(order.length, 10));
        await Promise.all(
          scan.map(async (idx, pos) => {
            const type = await loadAssetMediaType(assets[idx]);
            if (cancelled || type !== MediaType.IMAGE) return;
            if (fallbackPos == null || pos < fallbackPos) fallbackPos = pos;
          })
        );
      })();
      const fallback = () =>
        commitOnce(fallbackPos != null ? order[fallbackPos] : 0);
      // Hard deadline: entry selection must ALWAYS resolve, so a slow probe pass
      // can never leave the feed pinned on the loading Polaroid (Image #2).
      // After this, open the fallback photo and let its in-card load state
      // (blur-first delivery, "Accessing from iCloud…") cover any wait.
      // (Per-probe is already bounded in loadAssetIsInCloud.)
      const deadline = setTimeout(fallback, ENTRY_SELECT_DEADLINE_MS);
      (async () => {
        // Probe in small parallel batches (earliest candidate still wins within
        // a batch): sequential probing against a cold Photos framework burned
        // the whole deadline on one or two slow candidates, sending most cold
        // launches to the fallback instead of a random on-device memory.
        const BATCH = 4;
        for (let i = 0; i < order.length; i += BATCH) {
          const results = await Promise.all(
            order.slice(i, i + BATCH).map(async (idx) => ({
              idx,
              inCloud: await loadAssetIsInCloud(assets[idx]),
            }))
          );
          if (cancelled || committed) return;
          const hit = results.find((r) => !r.inCloud);
          if (hit) {
            commitOnce(hit.idx);
            return;
          }
        }
        // Whole sample was iCloud-resident (heavily offloaded library): commit
        // the earliest candidate confirmed to be a PHOTO — a random cloud
        // photo, painted blur-first while the in-card "Accessing from iCloud"
        // state covers the download. The probe loop above already resolved
        // every candidate's media type, so these reads are cache hits; an
        // UNKNOWN re-read that stalls is covered by the deadline.
        for (const idx of order) {
          const type = await loadAssetMediaType(assets[idx]);
          if (cancelled || committed) return;
          if (type === MediaType.IMAGE) {
            commitOnce(idx);
            return;
          }
        }
        fallback();
      })();
      return () => {
        cancelled = true;
        clearTimeout(deadline);
      };
    }
  }, [
    state,
    entryIndex,
    assets,
    prefetchAround,
    startAssetId,
    rememberLastPosition,
  ]);

  useEffect(() => {
    if (currentId && rememberLastPosition) rememberedAssetId = currentId;
  }, [currentId, rememberLastPosition]);

  // Safety net: if no card ever signals ready (e.g., the entry asset got
  // deleted, or a stuck iCloud download), drop the splash latch after a couple
  // seconds so the user isn't stuck staring at a stale image — and release the
  // warm-layer gate too, so shuffle still warms up even when the first photo
  // never reports painted.
  useEffect(() => {
    if (state.status !== 'ready' || entryIndex === null) return;
    const t = setTimeout(() => {
      setSplashLatched(false);
      setHasPaintedFirst(true);
    }, 2500);
    return () => clearTimeout(t);
  }, [state.status, entryIndex]);

  // Top the queue back up whenever the feed becomes active, the library
  // changes, a shuffle lands (currentId change recreates the callback), or an
  // entry is dropped (warmEntries shrinks) — but never while a crossfade is in
  // flight, so the warm layer's decodes can't compete with the destination
  // photo's own load. Converges via the queue-full early return in the refill.
  useEffect(() => {
    if (isActive && hasPaintedFirst && !outgoingAssetId && !transitionActive) {
      refillShuffleQueue();
    }
  }, [
    isActive,
    hasPaintedFirst,
    outgoingAssetId,
    transitionActive,
    warmEntries,
    refillShuffleQueue,
  ]);

  const shuffle = useCallback(() => {
    if (assets.length === 0) return;
    // The button is disabled while a transition is active; this synchronous
    // guard only covers the gap before that disable commits (double-taps
    // within a frame). Overlapping crossfades corrupted the overlay state and
    // stacked enough photo loads to starve the visible one for many seconds.
    if (shuffleBusyRef.current) return;

    // Prefer a destination whose hidden warm render has finished decoding the
    // FINAL image, then any confirmed on-device entry — never an un-downloaded
    // iCloud photo while something renderable is available.
    const loaded = warmLoaded;
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
  }, [assets, currentId, fadeOpacity, rememberLastPosition, warmLoaded]);

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

  // The current card's settled metadata, via the reactive hook rather than a
  // bare cache read in render (which the React Compiler would memoize stale —
  // see CLAUDE.md). Gates the Recreate button to confirmed photos; the visible
  // card hydrates the same asset, so this adds no native reads.
  const currentAsset = useMemo(
    () => (currentId ? (assets.find((a) => a.id === currentId) ?? null) : null),
    [assets, currentId]
  );
  const currentMeta = useAssetMetadata(currentAsset);
  const currentIsPhoto = currentMeta?.mediaType === MediaType.IMAGE;

  // Soft-dim the create ring on videos rather than unmounting it, so the
  // action triad's composition never jumps while swiping.
  const recreateFade = useAnimatedStyle(() => ({
    opacity: withTiming(currentIsPhoto ? 1 : 0.25, { duration: 180 }),
  }));

  // Open the recreation camera for the photo on screen, seeding it with the
  // metadata the card has already loaded (missing fields backfill lazily).
  const handleRecreate = useCallback(() => {
    if (!currentId) return;
    const asset = assets.find((a) => a.id === currentId);
    if (!asset) return;
    const cached = getCachedMetadata(currentId);
    if (cached?.mediaType === MediaType.VIDEO) return;
    requestRecreation({
      asset,
      creationTime: cached?.creationTime ?? null,
      location: cached?.location ?? null,
    });
  }, [assets, currentId]);

  // User tapped "Find one on device" on a card whose photo couldn't load: jump
  // to the nearest on-device memory (instant cut — no crossfade, since fading
  // from a black error frame is meaningless). Resolves whether it found one so
  // the card can show "None on device" instead of a silent no-op. Never
  // automatic; only this explicit tap moves the user.
  useEffect(() => {
    findOnDeviceHandlerRef.current = async (assetId: string) => {
      if (assetId !== currentId) return false;
      const idx = assets.findIndex((a) => a.id === currentId);
      if (idx < 0) return false;
      const jumpTo = (i: number) => {
        setCurrentId(assets[i].id);
        if (rememberLastPosition) rememberedAssetId = assets[i].id;
        listRef.current?.scrollToIndex({ index: i, animated: false });
      };
      // Instant path: something already KNOWN local from earlier probes.
      const candidates = assets.map((a) => ({ inCloud: getCachedIsInCloud(a.id) }));
      const cached = nextOnDeviceIndex(candidates, idx);
      if (cached != null) {
        jumpTo(cached);
        return true;
      }
      // Nothing known yet (cold caches, or a genuinely offloaded library): probe
      // forward from here in small batches for the first confirmed-local asset.
      // Bounded twice — a candidate cap and a hard time budget, since the user
      // is staring at the button — and videos auto-skip (they read as in-cloud).
      const SCAN_LIMIT = 40;
      const BATCH = 4;
      const scan = async (): Promise<number | null> => {
        const steps = Math.min(SCAN_LIMIT, assets.length - 1);
        for (let s = 1; s <= steps; s += BATCH) {
          const batch = Array.from(
            { length: Math.min(BATCH, steps - s + 1) },
            (_, k) => (idx + s + k) % assets.length
          );
          const results = await Promise.all(
            batch.map(async (i) => ({ i, inCloud: await loadAssetIsInCloud(assets[i]) }))
          );
          const hit = results.find((r) => !r.inCloud);
          if (hit) return hit.i;
        }
        return null;
      };
      const found = await withTimeoutDefault(scan(), FIND_ON_DEVICE_SCAN_MS, null);
      if (found == null) return false;
      jumpTo(found);
      return true;
    };
  }, [assets, currentId, rememberLastPosition]);

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
          <OverlayFramedPhoto uri={splash.uri} frame={frame} priority="high" />
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
                renderItem={({ item, index }) => (
                  // Per-card boundary: a single corrupt asset / bad metadata
                  // throw shows a fallback frame instead of taking the whole
                  // feed (and app) down.
                  <ErrorBoundary
                    fallback={() => (
                      <View
                        style={[
                          styles.cardFallback,
                          { width: layout.width, height: layout.height },
                        ]}>
                        <Text style={styles.body}>Couldn&apos;t show this memory.</Text>
                      </View>
                    )}>
                    <FeedCard
                      asset={item}
                      isCurrent={item.id === currentId}
                      isActive={isActive}
                      priority={cardLoadPriority(index, currentIndex)}
                      width={layout.width}
                      height={layout.height}
                      frame={frame}
                      onZoomChange={handleZoom}
                    />
                  </ErrorBoundary>
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
            priority="high"
            onReady={() => setOverlayPainted(true)}
          />
        </Animated.View>
      ) : null}

      {/* Hidden warm layer: decodes queued shuffle destinations at the card's
          exact frame size, so their cache entries are the ones the destination
          card reads (the cache key includes the view's pixel size — a plain
          prefetch can't populate it). Invisible and non-interactive. Mounts
          only what planWarmMounts admits: renderable entries plus one pending
          cloud download at a time. */}
      {isReady && (mountedWarmIds.length > 0 || downloadingOldId) ? (
        <View style={styles.warmLayer} pointerEvents="none">
          {mountedWarmIds.map((id) => (
            <OverlayFramedPhoto
              key={id}
              uri={id}
              frame={frame}
              priority="low"
              onReady={(ok, final) => {
                // Only the FINAL image counts as warm (the blur isn't cached and
                // its bytes aren't here); a failure drops the entry entirely —
                // and, when it was the active download, pauses the slot so a
                // fast-failing condition can't churn retries.
                if (ok && final) {
                  markWarmLoaded(id);
                } else if (!ok) {
                  if (id === pendingWarmId) {
                    setWarmPausedUntil(Date.now() + WARM_FAILURE_PAUSE_MS);
                  }
                  dropWarmEntry(id);
                }
              }}
            />
          ))}
          {downloadingOldId ? (
            <OverlayFramedPhoto
              key={`old-${downloadingOldId}`}
              uri={downloadingOldId}
              frame={frame}
              priority="low"
              onReady={(ok, final) => {
                // The blur landing just means the download is underway — keep
                // the slot until the full image (or a failure) settles it.
                if (ok && !final) return;
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

      {/* One centered action triad — share / shutter-ring / shuffle — on the
          same vertical axis as the frame and caption (everything on this page
          is center-composed; edge-pinned buttons were the one element off the
          axis and made the whole page read asymmetric). Fixed-width slots keep
          the geometry identical when a button hides (videos hide the camera,
          the memory overlay hides shuffle). */}
      {isReady && currentId ? (
        <View
          style={[styles.actionBar, { top: frame.top + frame.height + 80 }]}
          pointerEvents="box-none">
          <View style={styles.actionSlot}>
            <Pressable style={styles.actionBtn} onPress={handleShare} hitSlop={12}>
              <ShareIcon width={26} height={26} color={Ink} />
            </Pressable>
          </View>
          <View style={styles.actionSlot}>
            {/* Always mounted: on videos (and while the media type is still
                unconfirmed) it fades to a dimmed, disabled state instead of
                popping out of the row. */}
            <Animated.View style={recreateFade}>
              <Pressable
                style={styles.recreateBtn}
                onPress={handleRecreate}
                disabled={!currentIsPhoto}
                hitSlop={10}>
                <CameraIcon width={26} height={26} color={Ink} />
              </Pressable>
            </Animated.View>
          </View>
          <View style={styles.actionSlot}>
            {showShuffle ? (
              <Pressable
                style={[styles.actionBtn, transitionActive && styles.shuffleBusy]}
                onPress={shuffle}
                disabled={transitionActive}
                hitSlop={12}>
                <ShuffleIcon width={26} height={26} color={Ink} />
              </Pressable>
            ) : null}
          </View>
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
  cardFallback: {
    backgroundColor: Paper,
    alignItems: 'center',
    justifyContent: 'center',
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
  // The centered action triad, vertically centered in the band below the
  // caption (top set inline).
  actionBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 48,
  },
  // Fixed slot so a hidden button never shifts its neighbors.
  actionSlot: {
    width: 56,
    height: 56,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionBtn: {
    padding: 8,
  },
  // Shutter-ring create button: a hairline circle in the app's line-icon
  // weight, primary by size and center position rather than fill. No fill —
  // a swiping photo passes behind it and the ring should read as chrome, not
  // a solid puck sliding over the image.
  recreateBtn: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 2,
    borderColor: Ink,
    alignItems: 'center',
    justifyContent: 'center',
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
