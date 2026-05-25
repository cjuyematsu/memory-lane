import { useEffect, useRef, useState } from 'react';
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
import { useIsFocused } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

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
  onClose,
}: {
  items: NearbyAsset[];
  startIndex: number;
  onClose: () => void;
}) {
  const { width, height } = useWindowDimensions();
  const [index, setIndex] = useState(startIndex);
  const pagerRef = useRef<FlatList<NearbyAsset>>(null);
  const filmRef = useRef<ScrollView>(null);

  const translateY = useSharedValue(0);
  const backdropOpacity = useSharedValue(1);

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

  useEffect(() => {
    const thumbStride = THUMB_SIZE + THUMB_GAP;
    filmRef.current?.scrollTo({
      x: Math.max(0, index * thumbStride - width / 2 + THUMB_SIZE / 2),
      animated: true,
    });
  }, [index, width]);

  const jumpTo = (i: number) => {
    setIndex(i);
    pagerRef.current?.scrollToIndex({ index: i, animated: false });
  };

  return (
    <View style={StyleSheet.absoluteFill}>
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
                width={width}
                height={height}
              />
            )}
            extraData={index}
            onMomentumScrollEnd={(e) => {
              const next = Math.round(e.nativeEvent.contentOffset.x / width);
              if (next !== index) setIndex(next);
            }}
          />

          <SafeAreaView style={styles.topBar} pointerEvents="box-none">
            <Pressable style={styles.closeBtn} onPress={onClose} hitSlop={12}>
              <Text style={styles.closeLabel}>✕</Text>
            </Pressable>
          </SafeAreaView>

          <SafeAreaView style={styles.bottomBar} pointerEvents="box-none">
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
    </View>
  );
}

function ViewerPage({
  item,
  isCurrent,
  width,
  height,
}: {
  item: NearbyAsset;
  isCurrent: boolean;
  width: number;
  height: number;
}) {
  const meta = useAssetMetadata(item.asset);
  const placeName = useReverseGeocode(meta?.location ?? item.location ?? null);
  const isVideo = meta?.mediaType === MediaType.VIDEO;
  const playbackUri = usePlaybackUri(isVideo && isCurrent ? item.asset : null);
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
      {isVideo && isCurrent && playbackUri ? <ViewerVideo uri={playbackUri} /> : null}
      <View style={styles.gradient} pointerEvents="none" />
      <View style={styles.overlay}>
        <Text style={styles.timeAgo}>{formatTimeAgo(meta?.creationTime ?? null)}</Text>
        {placeName ? (
          <Text style={styles.place}>
            {item.isEstimated ? '~ ' : ''}
            {placeName}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

function ViewerVideo({ uri }: { uri: string }) {
  const isFocused = useIsFocused();
  const player = useVideoPlayer(uri, (p) => {
    p.loop = true;
    p.muted = false;
    p.play();
  });

  useEffect(() => {
    if (isFocused) {
      player.play();
    } else {
      player.pause();
    }
  }, [isFocused, player]);

  return (
    <VideoView
      player={player}
      style={StyleSheet.absoluteFill}
      contentFit="contain"
      nativeControls={false}
    />
  );
}

function FilmstripThumb({ item }: { item: NearbyAsset }) {
  const meta = useAssetMetadata(item.asset);
  const isVideo = meta?.mediaType === MediaType.VIDEO;
  const thumbnailUri = Platform.OS === 'ios' ? item.asset.id : meta?.uri;
  if (!thumbnailUri) return null;
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
}

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
  filmstrip: {
    gap: THUMB_GAP,
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 80,
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
