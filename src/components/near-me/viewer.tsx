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
import { PhotoFrame, frameTop } from '@/components/feed/photo-frame';
import { DisplayFont, FrameMargin, Ink, Paper, PhotoRatio } from '@/constants/theme';
import { useAssetMetadata, usePlaybackUri } from '@/hooks/use-asset-metadata';
import { useReverseGeocode } from '@/hooks/use-reverse-geocode';
import type { NearbyAsset } from '@/hooks/use-nearby-assets';
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

export function Viewer({
  items,
  startIndex,
  isActive = true,
  onClose,
  onOpenMemoryFeed,
  tapToAdvance = false,
}: {
  items: NearbyAsset[];
  startIndex: number;
  isActive?: boolean;
  onClose: () => void;
  onOpenMemoryFeed?: (assetId: string) => void;
  // Story-style navigation: tap right half → next, left half → previous, and
  // horizontal swipe is disabled. Used by the memories view.
  tapToAdvance?: boolean;
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

  const goNext = () => {
    if (index < items.length - 1) jumpTo(index + 1);
  };
  const goPrev = () => {
    if (index > 0) jumpTo(index - 1);
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
            scrollEnabled={!tapToAdvance}
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
              <Pressable style={styles.storyClose} onPress={handleClose} hitSlop={12}>
                <Text style={styles.closeLabel}>✕</Text>
              </Pressable>
            </SafeAreaView>
          ) : (
            <>
              <SafeAreaView style={styles.topBar} pointerEvents="box-none">
                <Pressable style={styles.closeBtn} onPress={handleClose} hitSlop={12}>
                  <Text style={styles.closeLabel}>✕</Text>
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
}: {
  item: NearbyAsset;
  isCurrent: boolean;
  isActive: boolean;
  width: number;
  height: number;
  bottomChrome: number;
}) {
  const insets = useSafeAreaInsets();
  const placeName = useReverseGeocode(item.location);
  const isVideo = item.mediaType === MediaType.VIDEO;
  const playbackUri = usePlaybackUri(isVideo && isCurrent ? item.asset : null);
  const meta = useAssetMetadata(Platform.OS === 'ios' ? null : item.asset);
  const thumbnailUri = Platform.OS === 'ios' ? item.asset.id : meta?.uri;

  // Same framed look as the Camera Roll feed: the photo sits inside a black
  // 3:4 frame on the white canvas, contained so the whole image is always
  // visible (letterboxed by the frame's black fill), with the time-ago/place
  // caption in Archivo Expanded Black below it. The frame is the largest 3:4
  // box that fits between the header and the bottom chrome with room for the
  // caption: on tall phones that's the full-width feed frame, and on short
  // phones it shrinks and stays centered so nothing overlaps.
  const top = frameTop(insets.top);
  const available = Math.max(
    0,
    height - top - bottomChrome - insets.bottom - CAPTION_RESERVE
  );
  const maxFrameW = width - 2 * FrameMargin;
  const frameH = Math.min(maxFrameW / PhotoRatio, available);
  const frameW = frameH * PhotoRatio;
  const frameLeft = (width - frameW) / 2;
  const captionTop = top + frameH + 24;

  return (
    <View style={{ width, height, backgroundColor: Paper }}>
      <PhotoFrame screenW={width} top={top} width={frameW} height={frameH} left={frameLeft}>
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
  storyClose: {
    alignSelf: 'flex-end',
    paddingHorizontal: 14,
    paddingVertical: 8,
    marginTop: 2,
  },
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
  },
  closeBtn: {
    marginTop: 2,
    marginLeft: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    alignSelf: 'flex-start',
  },
  closeLabel: {
    color: Ink,
    fontSize: 20,
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
