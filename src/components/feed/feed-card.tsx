import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Image } from 'expo-image';
import { Asset } from 'expo-media-library';

import { useReverseGeocode } from '@/hooks/use-reverse-geocode';
import { formatTimeAgo } from '@/utils/time-ago';

type CardData = {
  uri: string;
  creationTime: number | null;
  location: { latitude: number; longitude: number } | null;
};

const dataCache = new Map<string, CardData>();

export function FeedCard({
  asset,
  width,
  height,
}: {
  asset: Asset;
  width: number;
  height: number;
}) {
  const [data, setData] = useState<CardData | null>(() => dataCache.get(asset.id) ?? null);

  useEffect(() => {
    if (data) return;
    let cancelled = false;
    (async () => {
      try {
        const [info, location] = await Promise.all([
          asset.getInfo(),
          asset.getLocation().catch(() => null),
        ]);
        const next: CardData = {
          uri: info.uri,
          creationTime: info.creationTime,
          location,
        };
        dataCache.set(asset.id, next);
        if (!cancelled) setData(next);
      } catch {
        // asset disappeared; leave card blank
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [asset, data]);

  const placeName = useReverseGeocode(data?.location ?? null);

  return (
    <View style={[styles.container, { width, height }]}>
      {data ? (
        <Image
          source={{ uri: data.uri }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          transition={200}
        />
      ) : null}
      <View style={styles.gradient} pointerEvents="none" />
      <View style={styles.overlay}>
        <Text style={styles.timeAgo}>{formatTimeAgo(data?.creationTime ?? null)}</Text>
        {placeName ? <Text style={styles.place}>{placeName}</Text> : null}
      </View>
    </View>
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
