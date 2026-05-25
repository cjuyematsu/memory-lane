import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type ViewToken,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Image } from 'expo-image';
import { Asset, usePermissions } from 'expo-media-library';

import ShuffleIcon from '@/assets/icons/shuffle.svg';
import { FeedCard } from '@/components/feed/feed-card';
import { Colors } from '@/constants/theme';
import { useAssetFeed } from '@/hooks/use-asset-feed';

let rememberedAssetId: string | null = null;
const LOOP_PAD = 3;

export function Feed() {
  const [permission, requestPermission] = usePermissions();
  const granted = !!permission?.granted;
  const { state, reload } = useAssetFeed(granted);
  const window = useWindowDimensions();

  const [layout, setLayout] = useState({ width: window.width, height: window.height });
  const [entryIndex, setEntryIndex] = useState<number | null>(null);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const listRef = useRef<FlatList<Asset>>(null);

  const assets = state.status === 'ready' ? state.assets : [];
  const canLoop = assets.length >= LOOP_PAD + 1;

  const data = useMemo(() => {
    if (!canLoop) return assets;
    return [
      ...assets.slice(-LOOP_PAD),
      ...assets,
      ...assets.slice(0, LOOP_PAD),
    ];
  }, [assets, canLoop]);

  const prefetchAround = useCallback(
    (idx: number) => {
      if (Platform.OS !== 'ios') return;
      const uris: string[] = [];
      for (const d of [-2, -1, 1, 2, 3]) {
        const a = assets[idx + d];
        if (a) uris.push(a.id);
      }
      if (uris.length > 0) Image.prefetch(uris).catch(() => {});
    },
    [assets]
  );

  useEffect(() => {
    if (state.status === 'ready' && entryIndex === null && assets.length > 0) {
      let chosenIdx: number;
      if (rememberedAssetId) {
        const idx = assets.findIndex((a) => a.id === rememberedAssetId);
        if (idx >= 0) {
          setEntryIndex(idx);
          setCurrentId(rememberedAssetId);
          if (Platform.OS === 'ios') Image.prefetch(rememberedAssetId).catch(() => {});
          prefetchAround(idx);
          return;
        }
      }
      chosenIdx = Math.floor(Math.random() * assets.length);
      setEntryIndex(chosenIdx);
      setCurrentId(assets[chosenIdx].id);
      rememberedAssetId = assets[chosenIdx].id;
      if (Platform.OS === 'ios') Image.prefetch(assets[chosenIdx].id).catch(() => {});
      prefetchAround(chosenIdx);
    }
  }, [state, entryIndex, assets, prefetchAround]);

  useEffect(() => {
    if (currentId) rememberedAssetId = currentId;
  }, [currentId]);

  const shuffle = useCallback(() => {
    if (assets.length === 0) return;
    const next = Math.floor(Math.random() * assets.length);
    setEntryIndex(next);
    setCurrentId(assets[next].id);
    prefetchAround(next);
    listRef.current?.scrollToIndex({
      index: canLoop ? next + LOOP_PAD : next,
      animated: false,
    });
  }, [assets, canLoop, prefetchAround]);

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

  const onMomentumScrollEnd = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      if (!canLoop || layout.height <= 0) return;
      const y = e.nativeEvent.contentOffset.y;
      const idx = Math.round(y / layout.height);
      if (idx < LOOP_PAD) {
        const real = idx + assets.length;
        listRef.current?.scrollToOffset({ offset: real * layout.height, animated: false });
      } else if (idx >= LOOP_PAD + assets.length) {
        const real = idx - assets.length;
        listRef.current?.scrollToOffset({ offset: real * layout.height, animated: false });
      }
    },
    [canLoop, layout.height, assets.length]
  );

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

  if (state.status === 'idle' || state.status === 'loading') {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#fff" />
      </View>
    );
  }

  if (state.status === 'error') {
    return (
      <SafeAreaView style={styles.center}>
        <Text style={styles.body}>{state.message}</Text>
        <Pressable style={styles.button} onPress={() => reload()}>
          <Text style={styles.buttonLabel}>Retry</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  if (state.assets.length === 0) {
    return (
      <SafeAreaView style={styles.center}>
        <Text style={styles.body}>No photos.</Text>
      </SafeAreaView>
    );
  }

  if (entryIndex === null) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#fff" />
      </View>
    );
  }

  return (
    <View
      style={styles.container}
      onLayout={(e) => {
        const next = e.nativeEvent.layout;
        if (next.height !== layout.height || next.width !== layout.width) {
          setLayout({ width: next.width, height: next.height });
        }
      }}>
      <FlatList
        ref={listRef}
        data={data}
        keyExtractor={(item, index) => {
          if (!canLoop) return item.id;
          if (index < LOOP_PAD) return `pre-${item.id}-${index}`;
          if (index >= LOOP_PAD + assets.length) return `post-${item.id}-${index}`;
          return item.id;
        }}
        renderItem={({ item }) => (
          <FeedCard
            asset={item}
            isCurrent={item.id === currentId}
            width={layout.width}
            height={layout.height}
          />
        )}
        pagingEnabled
        snapToInterval={layout.height}
        snapToAlignment="start"
        disableIntervalMomentum
        showsVerticalScrollIndicator={false}
        initialScrollIndex={canLoop ? entryIndex + LOOP_PAD : entryIndex}
        getItemLayout={getItemLayout}
        decelerationRate="fast"
        windowSize={5}
        initialNumToRender={3}
        maxToRenderPerBatch={3}
        removeClippedSubviews
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={viewabilityConfig}
        onMomentumScrollEnd={onMomentumScrollEnd}
        extraData={currentId}
      />
      <SafeAreaView style={styles.shuffleWrapper} pointerEvents="box-none">
        <Pressable style={styles.shuffle} onPress={shuffle} hitSlop={12}>
          <ShuffleIcon width={28} height={28} fill="#fff" />
        </Pressable>
      </SafeAreaView>
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
    bottom: 0,
    right: 0,
    alignItems: 'flex-end',
  },
  shuffle: {
    margin: 24,
    padding: 6,
  },
});
