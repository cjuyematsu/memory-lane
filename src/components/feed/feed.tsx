import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Asset, usePermissions } from 'expo-media-library';

import { FeedCard } from '@/components/feed/feed-card';
import { Colors } from '@/constants/theme';
import { useAssetFeed } from '@/hooks/use-asset-feed';

export function Feed() {
  const [permission, requestPermission] = usePermissions();
  const granted = !!permission?.granted;
  const { state, reload } = useAssetFeed(granted);
  const { width, height } = useWindowDimensions();

  const [entryIndex, setEntryIndex] = useState<number | null>(null);
  const listRef = useRef<FlatList<Asset>>(null);

  useEffect(() => {
    if (state.status === 'ready' && entryIndex === null && state.assets.length > 0) {
      setEntryIndex(Math.floor(Math.random() * state.assets.length));
    }
  }, [state, entryIndex]);

  const shuffle = useCallback(() => {
    if (state.status !== 'ready' || state.assets.length === 0) return;
    const next = Math.floor(Math.random() * state.assets.length);
    setEntryIndex(next);
    listRef.current?.scrollToIndex({ index: next, animated: false });
  }, [state]);

  const getItemLayout = useCallback(
    (_: ArrayLike<Asset> | null | undefined, index: number) => ({
      length: height,
      offset: height * index,
      index,
    }),
    [height]
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
        <Pressable style={styles.button} onPress={reload}>
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
    <View style={styles.container}>
      <FlatList
        ref={listRef}
        data={state.assets}
        keyExtractor={(a) => a.id}
        renderItem={({ item }) => <FeedCard asset={item} width={width} height={height} />}
        pagingEnabled
        showsVerticalScrollIndicator={false}
        initialScrollIndex={entryIndex}
        getItemLayout={getItemLayout}
        decelerationRate="fast"
        windowSize={5}
        initialNumToRender={3}
        maxToRenderPerBatch={3}
        removeClippedSubviews
      />
      <SafeAreaView style={styles.shuffleWrapper} pointerEvents="box-none">
        <Pressable style={styles.shuffle} onPress={shuffle}>
          <Text style={styles.shuffleLabel}>shuffle</Text>
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
    top: 0,
    right: 0,
  },
  shuffle: {
    margin: 16,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 18,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  shuffleLabel: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
});
