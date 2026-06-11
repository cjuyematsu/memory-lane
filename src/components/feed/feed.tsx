import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
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
import { Asset } from 'expo-media-library';

import ShuffleIcon from '@/assets/icons/shuffle.svg';
import { FeedCard } from '@/components/feed/feed-card';
import { FeedCardEventsContext, type FeedCardEvents } from '@/components/feed/feed-context';
import { PhotoFrame, frameLayout, type FrameLayout } from '@/components/feed/photo-frame';
import { DisplayFont, Ink, Paper } from '@/constants/theme';
import { useAssetFeed } from '@/hooks/use-asset-feed';
import {
  getCachedMetadata,
  hydrateAsset,
} from '@/hooks/use-asset-metadata';
import { useMediaPermission } from '@/hooks/use-media-permission';
import { prefetchReverseGeocode } from '@/hooks/use-reverse-geocode';

let rememberedAssetId: string | null = null;
const SHUFFLE_QUEUE_SIZE = 4;
const SHUFFLE_PREFETCH_TIMEOUT_MS = 600;
const CROSSFADE_DURATION_MS = 280;
const CARD_READY_TIMEOUT_MS = 1500;
const OVERLAY_READY_TIMEOUT_MS = 600;
// Vertical space below the frame for the caption + shuffle button (+ safe-area
// inset, added separately). The frame is sized to leave this much room, so on
// phones it stays the full-width box and on iPad it shrinks to keep the caption
// and shuffle on screen.
const FEED_BOTTOM_RESERVE = 130;

function warmAsset(asset: Asset) {
  Image.prefetch(asset.id).catch(() => {});
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
  onReady?: () => void;
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
          onReady?.();
        }}
        onError={() => onReady?.()}
      />
    </PhotoFrame>
  );
}

export function Feed({
  startAssetId,
  rememberLastPosition = true,
  showShuffle = true,
  isActive = true,
}: {
  startAssetId?: string | null;
  rememberLastPosition?: boolean;
  showShuffle?: boolean;
  isActive?: boolean;
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
  const [shuffleQueue, setShuffleQueue] = useState<string[]>([]);
  const [outgoingAssetId, setOutgoingAssetId] = useState<string | null>(null);
  const [overlayPainted, setOverlayPainted] = useState(false);
  const [splashLatched, setSplashLatched] = useState(true);
  const listRef = useRef<FlatList<Asset>>(null);
  const fadeOpacity = useSharedValue(0);
  const cardReadyHandlerRef = useRef<(assetId: string) => void>(() => {});
  const pendingShuffleRef = useRef<{ pickedId: string; newIdx: number } | null>(
    null
  );

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

  const cardEvents = useMemo<FeedCardEvents>(
    () => ({
      onCardReady: (assetId: string) => {
        cardReadyHandlerRef.current(assetId);
        setSplashLatched(false);
      },
    }),
    []
  );

  const overlayStyle = useAnimatedStyle(() => ({
    opacity: fadeOpacity.value,
  }));

  const finishCrossfade = useCallback(() => {
    setOutgoingAssetId(null);
    setOverlayPainted(false);
  }, []);

  // Shared frame geometry for the live card, the crossfade/splash overlays, and
  // the shuffle button, so all three line up and scale together on any screen.
  const frame = useMemo(
    () =>
      frameLayout(layout.width, layout.height, insets.top, insets.bottom, FEED_BOTTOM_RESERVE),
    [layout.width, layout.height, insets.top, insets.bottom]
  );

  const assets = state.status === 'ready' ? state.assets : [];

  const prefetchAround = useCallback(
    (idx: number) => {
      if (!isActive) return;
      // Warm a couple cards in each direction so a quick flick doesn't outrun
      // the decode and land on an unrendered (white) card.
      for (const d of [-2, -1, 1, 2]) {
        const a = assets[idx + d];
        if (a) warmAsset(a);
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
        warmAsset(chosen);
        prefetchAround(idx);
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
      commit(Math.floor(Math.random() * assets.length));
    }
  }, [state, entryIndex, assets, prefetchAround, startAssetId, rememberLastPosition]);

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

  useEffect(() => {
    if (!isActive) return;
    if (assets.length === 0) return;
    if (shuffleQueue.length >= SHUFFLE_QUEUE_SIZE) return;

    const exclude = new Set<string>(shuffleQueue);
    if (currentId) exclude.add(currentId);

    const need = SHUFFLE_QUEUE_SIZE - shuffleQueue.length;
    const additions: string[] = [];
    for (let i = 0; i < 50 && additions.length < need; i++) {
      const candidate = assets[Math.floor(Math.random() * assets.length)].id;
      if (!exclude.has(candidate)) {
        additions.push(candidate);
        exclude.add(candidate);
      }
    }
    if (additions.length > 0) {
      for (const id of additions) {
        const a = assets.find((x) => x.id === id);
        if (a) warmAsset(a);
      }
      setShuffleQueue((prev) => [...prev, ...additions]);
    }
  }, [shuffleQueue, currentId, assets, isActive]);

  const shuffle = useCallback(async () => {
    if (assets.length === 0) return;

    let pickedId: string | undefined;
    let queueDrop = 0;
    for (const candidate of shuffleQueue) {
      queueDrop++;
      if (candidate !== currentId && assets.some((a) => a.id === candidate)) {
        pickedId = candidate;
        break;
      }
    }
    if (queueDrop > 0) {
      setShuffleQueue((prev) => prev.slice(queueDrop));
    }
    const pickedAsset = pickedId ? assets.find((a) => a.id === pickedId) : undefined;
    if (!pickedId || !pickedAsset) {
      const idx = Math.floor(Math.random() * assets.length);
      pickedId = assets[idx].id;
      await Promise.race([
        Image.prefetch(pickedId).catch(() => {}),
        new Promise((r) => setTimeout(r, SHUFFLE_PREFETCH_TIMEOUT_MS)),
      ]);
    } else {
      warmAsset(pickedAsset);
    }

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
  }, [assets, currentId, fadeOpacity, rememberLastPosition, shuffleQueue]);

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
            (finished) => {
              'worklet';
              if (finished) scheduleOnRN(finishCrossfade);
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

  const onViewableItemsChanged = useRef(
    ({ viewableItems }: { viewableItems: ViewToken<Asset>[] }) => {
      const first = viewableItems[0];
      if (first?.item) {
        setCurrentId(first.item.id);
      }
    }
  ).current;

  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 60 }).current;

  if (!permission) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={Ink} />
      </View>
    );
  }

  if (!permission.granted) {
    // Once denied, requestPermission() is a silent no-op — send them to Settings.
    const canAsk = permission.canAskAgain;
    return (
      <SafeAreaView style={styles.center}>
        <Text style={styles.title}>Mems</Text>
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
        <View style={styles.center}>
          <ActivityIndicator color={Ink} />
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
          <FlatList
            ref={listRef}
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
              />
            )}
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
            viewabilityConfig={viewabilityConfig}
            extraData={`${currentId}|${isActive}`}
          />
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

      {isReady && showShuffle ? (
        <View
          style={[
            styles.shuffleWrapper,
            // Centered in the empty band between the caption and the screen
            // bottom (frame bottom + the ~caption block height).
            { top: frame.top + frame.height + 80 },
          ]}
          pointerEvents="box-none">
          <Pressable style={styles.shuffle} onPress={shuffle} hitSlop={12}>
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
  shuffle: {
    padding: 8,
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
