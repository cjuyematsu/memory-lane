import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type ViewToken,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { Image } from 'expo-image';
import { Asset, usePermissions } from 'expo-media-library';

import ShuffleIcon from '@/assets/icons/shuffle.svg';
import { FeedCard, FEED_CAPTION_HEIGHT } from '@/components/feed/feed-card';
import { FeedCardEventsContext, type FeedCardEvents } from '@/components/feed/feed-context';
import { Colors } from '@/constants/theme';
import { useAssetFeed } from '@/hooks/use-asset-feed';
import {
  getCachedMetadata,
  hydrateAsset,
} from '@/hooks/use-asset-metadata';
import { prefetchReverseGeocode } from '@/hooks/use-reverse-geocode';

let rememberedAssetId: string | null = null;
const SHUFFLE_QUEUE_SIZE = 4;
const SHUFFLE_PREFETCH_TIMEOUT_MS = 600;
const CROSSFADE_DURATION_MS = 280;
const CARD_READY_TIMEOUT_MS = 1500;

function warmAsset(asset: Asset) {
  Image.prefetch(asset.id).catch(() => {});
  hydrateAsset(asset)
    .then((meta) => {
      if (meta?.location) prefetchReverseGeocode(meta.location);
    })
    .catch(() => {});
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
  const [permission, requestPermission] = usePermissions();
  const granted = !!permission?.granted;
  const { state, reload } = useAssetFeed(granted);
  const window = useWindowDimensions();

  const [layout, setLayout] = useState({ width: window.width, height: window.height });
  const [layoutMeasured, setLayoutMeasured] = useState(false);
  const [entryIndex, setEntryIndex] = useState<number | null>(null);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [shuffleQueue, setShuffleQueue] = useState<string[]>([]);
  const [outgoingAssetId, setOutgoingAssetId] = useState<string | null>(null);
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

  const assets = state.status === 'ready' ? state.assets : [];

  const prefetchAround = useCallback(
    (idx: number) => {
      if (!isActive) return;
      for (const d of [-1, 1]) {
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
      // Stage the destination but DON'T scroll yet. The useEffect below
      // fires after the overlay has actually committed/painted, then it
      // performs the scroll and wires up the card-ready handler. This is
      // a hard guarantee that the FlatList doesn't move under the user
      // until the overlay is on screen — RAF-based timing was unreliable
      // on Android.
      pendingShuffleRef.current = { pickedId, newIdx };
      setOutgoingAssetId(prevId);
      fadeOpacity.value = 1;
      return;
    }

    // No crossfade needed (no prior current, or same target): direct commit.
    setCurrentId(pickedId);
    if (rememberLastPosition) rememberedAssetId = pickedId;
    listRef.current?.scrollToIndex({ index: newIdx, animated: false });
  }, [assets, currentId, fadeOpacity, rememberLastPosition, shuffleQueue]);

  // Once the overlay is on screen (state has committed + painted), commit
  // the scroll and set up the card-ready handler that drives the fade-out.
  useEffect(() => {
    if (!outgoingAssetId) return;
    const pending = pendingShuffleRef.current;
    if (!pending) return;
    pendingShuffleRef.current = null;

    let timer: ReturnType<typeof setTimeout> | null = null;
    const rafId = requestAnimationFrame(() => {
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
            if (finished) scheduleOnRN(setOutgoingAssetId, null);
          }
        );
      };
      cardReadyHandlerRef.current = (readyId) => {
        if (readyId === pending.pickedId) startFadeOut();
      };
      timer = setTimeout(startFadeOut, CARD_READY_TIMEOUT_MS);
    });

    return () => {
      cancelAnimationFrame(rafId);
      if (timer) clearTimeout(timer);
    };
  }, [outgoingAssetId, rememberLastPosition, fadeOpacity]);

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
        <ActivityIndicator color="#fff" />
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <SafeAreaView style={styles.center}>
        <Text style={styles.title}>Mems</Text>
        <Text style={styles.body}>We need access to your photos.</Text>
        <Pressable style={styles.button} onPress={requestPermission}>
          <Text style={styles.buttonLabel}>Grant access</Text>
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
          <View
            style={[
              styles.splashMedia,
              { height: Math.max(0, layout.height - FEED_CAPTION_HEIGHT) },
            ]}>
            <Image
              source={{ uri: splash.uri }}
              style={StyleSheet.absoluteFill}
              contentFit="contain"
              cachePolicy="memory-disk"
              transition={0}
            />
          </View>
        </View>
      ) : null}

      {isLoading && (!splash || !splashLatched) ? (
        <View style={styles.center}>
          <ActivityIndicator color="#fff" />
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
            windowSize={2}
            initialNumToRender={1}
            maxToRenderPerBatch={2}
            removeClippedSubviews
            onViewableItemsChanged={onViewableItemsChanged}
            viewabilityConfig={viewabilityConfig}
            extraData={`${currentId}|${isActive}`}
          />
        </FeedCardEventsContext.Provider>
      ) : null}

      {outgoingAssetId ? (
        <Animated.View
          style={[
            styles.crossfadeOverlay,
            { height: Math.max(0, layout.height - FEED_CAPTION_HEIGHT) },
            overlayStyle,
          ]}
          pointerEvents="none">
          <Image
            source={{ uri: outgoingAssetId }}
            style={StyleSheet.absoluteFill}
            contentFit="contain"
            cachePolicy="memory-disk"
            transition={0}
          />
        </Animated.View>
      ) : null}

      {isReady && showShuffle ? (
        <View style={styles.shuffleWrapper} pointerEvents="box-none">
          <Pressable style={styles.shuffle} onPress={shuffle} hitSlop={12}>
            <ShuffleIcon width={28} height={28} fill="#fff" />
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  center: {
    flex: 1,
    backgroundColor: Colors.dark.background,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    paddingHorizontal: 24,
  },
  title: {
    color: '#fff',
    fontSize: 48,
    fontWeight: '600',
  },
  body: {
    color: '#fff',
    fontSize: 16,
    textAlign: 'center',
  },
  button: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 32,
    backgroundColor: Colors.dark.backgroundElement,
  },
  buttonLabel: {
    color: '#fff',
    fontWeight: '700',
  },
  shuffleWrapper: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    height: FEED_CAPTION_HEIGHT,
    paddingTop: 2,
    paddingRight: 20,
    alignItems: 'flex-end',
  },
  shuffle: {
    padding: 6,
  },
  crossfadeOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    backgroundColor: '#000',
  },
  splashMedia: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
  },
});
