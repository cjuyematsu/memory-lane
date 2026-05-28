import { memo, useEffect, useRef, useState } from 'react';
import {
  FlatList,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

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
import { useAssetMetadata, usePlaybackUri } from '@/hooks/use-asset-metadata';
import { useReverseGeocode } from '@/hooks/use-reverse-geocode';
import type { NearbyAsset } from '@/hooks/use-nearby-assets';
import { formatTimeAgo } from '@/utils/time-ago';

const THUMB_SIZE = 56;
const THUMB_GAP = 6;
const DISMISS_THRESHOLD = 120;

export function Viewer({
  items,
  startIndex,
  isActive = true,
  onClose,
  onOpenMemoryFeed,
}: {
  items: NearbyAsset[];
  startIndex: number;
  isActive?: boolean;
  onClose: () => void;
  onOpenMemoryFeed?: (assetId: string) => void;
}) {
  const { width, height } = useWindowDimensions();
  const [index, setIndex] = useState(startIndex);
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

  const jumpTo = (i: number) => {
    setIndex(i);
    pagerRef.current?.scrollToIndex({ index: i, animated: false });
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
              />
            )}
            extraData={index}
            windowSize={3}
            initialNumToRender={1}
            maxToRenderPerBatch={2}
            removeClippedSubviews
            onMomentumScrollEnd={(e) => {
              const next = Math.round(e.nativeEvent.contentOffset.x / width);
              if (next !== index) setIndex(next);
            }}
          />

          <SafeAreaView style={styles.topBar} pointerEvents="box-none">
            <Pressable style={styles.closeBtn} onPress={handleClose} hitSlop={12}>
              <Text style={styles.closeLabel}>✕</Text>
            </Pressable>
          </SafeAreaView>

          <SafeAreaView style={styles.bottomBar} edges={['bottom']} pointerEvents="box-none">
            {onOpenMemoryFeed ? (
              <View style={styles.filmRow} pointerEvents="box-none">
                <Pressable
                  onPress={() => onOpenMemoryFeed(items[index].asset.id)}
                  style={styles.filmBtn}
                  hitSlop={12}>
                  <FilmIcon width={28} height={28} fill="#fff" />
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
}: {
  item: NearbyAsset;
  isCurrent: boolean;
  isActive: boolean;
  width: number;
  height: number;
}) {
  const placeName = useReverseGeocode(item.location);
  const isVideo = item.mediaType === MediaType.VIDEO;
  const playbackUri = usePlaybackUri(isVideo && isCurrent ? item.asset : null);
  const meta = useAssetMetadata(Platform.OS === 'ios' ? null : item.asset);
  const thumbnailUri = Platform.OS === 'ios' ? item.asset.id : meta?.uri;

  return (
    <View style={{ width, height, backgroundColor: '#000' }}>
      {thumbnailUri ? (
        <Image
          source={{ uri: thumbnailUri }}
          style={StyleSheet.absoluteFill}
          contentFit="contain"
          cachePolicy="memory-disk"
          transition={0}
          recyclingKey={item.asset.id}
        />
      ) : null}
      {isVideo && isCurrent && isActive && playbackUri ? (
        <ViewerVideo uri={playbackUri} />
      ) : null}
      <View style={styles.gradient} pointerEvents="none" />
      <View style={styles.overlay}>
        <Text style={styles.timeAgo}>{formatTimeAgo(item.creationTime)}</Text>
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

function ViewerVideo({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, (p) => {
    p.loop = true;
    p.muted = true;
    p.play();
  });

  return (
    <VideoView
      key={uri}
      player={player}
      style={StyleSheet.absoluteFill}
      contentFit="contain"
      nativeControls={false}
    />
  );
}

const FilmstripThumb = memo(function FilmstripThumb({ item }: { item: NearbyAsset }) {
  const isVideo = item.mediaType === MediaType.VIDEO;
  const meta = useAssetMetadata(Platform.OS === 'ios' ? null : item.asset);
  const thumbnailUri = Platform.OS === 'ios' ? item.asset.id : meta?.uri;
  if (!thumbnailUri) return <View style={styles.thumb} />;
  return (
    <View style={styles.thumb}>
      <Image
        source={{ uri: thumbnailUri }}
        style={styles.thumb}
        contentFit="cover"
        cachePolicy="memory-disk"
        transition={0}
        recyclingKey={item.asset.id}
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
    backgroundColor: '#000',
  },
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
  },
  closeBtn: {
    margin: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignSelf: 'flex-start',
  },
  closeLabel: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
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
    borderColor: '#fff',
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
  gradient: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 220,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  overlay: {
    position: 'absolute',
    bottom: 160,
    left: 20,
    right: 20,
    gap: 4,
  },
  timeAgo: {
    color: '#fff',
    fontSize: 26,
    fontWeight: '700',
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 6,
  },
  place: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '500',
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 6,
  },
});
