import { useEffect, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';

import { Image } from 'expo-image';
import { Asset, MediaType } from 'expo-media-library';
import { VideoView, useVideoPlayer } from 'expo-video';

import { useAssetMetadata, usePlaybackUri } from '@/hooks/use-asset-metadata';
import { useReverseGeocode } from '@/hooks/use-reverse-geocode';
import { formatTimeAgo } from '@/utils/time-ago';

const PLACE_TIMEOUT_MS = 1500;

export function FeedCard({
  asset,
  isCurrent,
  width,
  height,
}: {
  asset: Asset;
  isCurrent: boolean;
  width: number;
  height: number;
}) {
  const meta = useAssetMetadata(asset);
  const placeName = useReverseGeocode(meta?.location ?? null);
  const isVideo = meta?.mediaType === MediaType.VIDEO;
  const playbackUri = usePlaybackUri(isVideo && isCurrent ? asset : null);
  const thumbnailUri = Platform.OS === 'ios' ? asset.id : meta?.uri;

  const [placeTimedOut, setPlaceTimedOut] = useState(false);
  useEffect(() => {
    setPlaceTimedOut(false);
    if (!meta?.location || placeName) return;
    const t = setTimeout(() => setPlaceTimedOut(true), PLACE_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [meta?.location, placeName]);

  const overlayReady =
    meta != null && (meta.location == null || placeName != null || placeTimedOut);

  return (
    <View style={[styles.container, { width, height }]}>
      {thumbnailUri ? (
        <Image
          source={{ uri: thumbnailUri }}
          style={StyleSheet.absoluteFill}
          contentFit="contain"
          cachePolicy="memory-disk"
          transition={0}
          recyclingKey={asset.id}
        />
      ) : null}
      {isVideo && isCurrent && playbackUri ? <FeedVideo uri={playbackUri} /> : null}
      <View style={styles.gradient} pointerEvents="none" />
      {overlayReady ? (
        <View style={styles.overlay}>
          <Text style={styles.timeAgo}>{formatTimeAgo(meta.creationTime)}</Text>
          {placeName ? <Text style={styles.place}>{placeName}</Text> : null}
        </View>
      ) : null}
    </View>
  );
}

function FeedVideo({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, (p) => {
    p.loop = true;
    p.muted = true;
    p.play();
  });

  return (
    <VideoView
      player={player}
      style={StyleSheet.absoluteFill}
      contentFit="contain"
      nativeControls={false}
    />
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#000',
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
    bottom: 100,
    left: 24,
    right: 24,
    gap: 6,
  },
  timeAgo: {
    color: '#fff',
    fontSize: 30,
    fontWeight: '700',
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 6,
  },
  place: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '500',
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 6,
  },
});
