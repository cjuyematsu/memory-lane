import { memo, useContext, useEffect, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';

import { Image } from 'expo-image';
import { Asset, MediaType } from 'expo-media-library';
import { VideoView, useVideoPlayer } from 'expo-video';

import { FeedCardEventsContext } from '@/components/feed/feed-context';
import { useAssetMetadata, usePlaybackUri } from '@/hooks/use-asset-metadata';
import { useReverseGeocode } from '@/hooks/use-reverse-geocode';
import { formatTimeAgo } from '@/utils/time-ago';

const PLACE_TIMEOUT_MS = 1500;

export const FeedCard = memo(function FeedCard({
  asset,
  isCurrent,
  isActive = true,
  width,
  height,
}: {
  asset: Asset;
  isCurrent: boolean;
  isActive?: boolean;
  width: number;
  height: number;
}) {
  const meta = useAssetMetadata(asset);
  const placeName = useReverseGeocode(meta?.location ?? null);
  const isVideo = meta?.mediaType === MediaType.VIDEO;
  const playbackUri = usePlaybackUri(isVideo && isCurrent && isActive ? asset : null);
  const thumbnailUri = Platform.OS === 'ios' ? asset.id : meta?.uri;
  const { onCardReady } = useContext(FeedCardEventsContext);

  const [placeTimedOut, setPlaceTimedOut] = useState(false);
  const [imageReady, setImageReady] = useState(false);
  useEffect(() => {
    setPlaceTimedOut(false);
    if (!meta?.location || placeName) return;
    const t = setTimeout(() => setPlaceTimedOut(true), PLACE_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [meta?.location, placeName]);

  const overlayReady =
    meta != null && (meta.location == null || placeName != null || placeTimedOut);
  const cardReady = imageReady && overlayReady;

  // Keep the card invisible until the image is actually decoded AND the
  // metadata/placename has settled, then snap to full opacity. The previous
  // 180ms fade was perceived as a "flash" — a visible dim-to-bright sweep
  // on every new card. Snap-in keeps the linked image+caption guarantee
  // (both appear together, never one before the other) without the visible
  // transition. The shuffle/wrap crossfade overlay covers the brief invisible
  // window during loading, so the user only sees the snap when the card is
  // actually ready.
  const opacity = useSharedValue(0);
  const opacityStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  useEffect(() => {
    if (!cardReady) return;
    opacity.value = 1;
    onCardReady(asset.id);
  }, [cardReady, opacity, onCardReady, asset.id]);

  return (
    <Animated.View style={[styles.container, { width, height }, opacityStyle]}>
      <View style={styles.media}>
        {thumbnailUri ? (
          <Image
            source={{ uri: thumbnailUri }}
            style={StyleSheet.absoluteFill}
            contentFit="contain"
            cachePolicy={isCurrent ? 'memory-disk' : 'disk'}
            transition={0}
            recyclingKey={asset.id}
            onLoad={() => setImageReady(true)}
            onError={() => setImageReady(true)}
          />
        ) : null}
        {isVideo && isCurrent && isActive && playbackUri ? <FeedVideo uri={playbackUri} /> : null}
      </View>
      <View style={styles.captionRow}>
        {overlayReady ? (
          <View style={styles.captionText}>
            <Text style={styles.timeAgo}>{formatTimeAgo(meta.creationTime)}</Text>
            {placeName ? <Text style={styles.place}>{placeName}</Text> : null}
          </View>
        ) : (
          <View style={styles.captionText} />
        )}
      </View>
    </Animated.View>
  );
});

function FeedVideo({ uri }: { uri: string }) {
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

const CAPTION_ROW_HEIGHT = 150;

export const FEED_CAPTION_HEIGHT = CAPTION_ROW_HEIGHT;

const styles = StyleSheet.create({
  container: {
    // intentionally transparent: while the card fades in, whatever sits
    // behind it (splash backdrop or the Feed's #000 container) shows through.
    backgroundColor: 'transparent',
  },
  media: {
    flex: 1,
  },
  captionRow: {
    height: CAPTION_ROW_HEIGHT,
    paddingLeft: 24,
    paddingRight: 72,
    paddingTop: 4,
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  captionText: {
    flex: 1,
    gap: 4,
  },
  timeAgo: {
    color: '#fff',
    fontSize: 24,
    fontWeight: '700',
  },
  place: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '500',
    opacity: 0.85,
  },
});
