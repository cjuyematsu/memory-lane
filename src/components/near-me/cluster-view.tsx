import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { Asset, MediaType } from 'expo-media-library';

import { Viewer } from '@/components/near-me/viewer';
import { DisplayFont, Ink, Paper } from '@/constants/theme';
import { getIndex } from '@/hooks/use-located-assets';
import { loadClustersFromDisk, type PhotoCluster } from '@/hooks/use-photo-clusters';
import type { NearbyAsset } from '@/hooks/use-nearby-assets';

// The "memories" view: a tapped notification opens this. Unlike Near Me's
// grid, it's a full-screen story you swipe through — scoped tightly to the
// one place you were notified about. Reuses the Viewer (full-screen pager +
// filmstrip + time-ago/place captions); dismissing it (swipe down / ✕)
// reveals the wide-radius Near Me grid underneath.
export function ClusterView({
  clusterId,
  assets,
  isActive,
  onBack,
}: {
  clusterId: string;
  assets: Asset[] | null;
  isActive: boolean;
  onBack: () => void;
}) {
  const [cluster, setCluster] = useState<PhotoCluster | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let active = true;
    setLoaded(false);
    loadClustersFromDisk().then((clusters) => {
      if (!active) return;
      setCluster(clusters?.find((c) => c.id === clusterId) ?? null);
      setLoaded(true);
    });
    return () => {
      active = false;
    };
  }, [clusterId]);

  const items = useMemo<NearbyAsset[]>(() => {
    if (!cluster || !assets) return [];
    const assetById = new Map(assets.map((a) => [a.id, a]));
    // Per-asset location/time/type come from the same shared index the cluster
    // was derived from, so this matches Near Me's data exactly.
    const located = getIndex()?.located ?? [];
    const locById = new Map(located.map((l) => [l.id, l]));
    const result: NearbyAsset[] = [];
    for (const id of cluster.assetIds) {
      const asset = assetById.get(id);
      if (!asset) continue;
      const loc = locById.get(id);
      result.push({
        asset,
        location: loc
          ? { latitude: loc.lat, longitude: loc.lng }
          : { latitude: cluster.centerLat, longitude: cluster.centerLng },
        distance: 0,
        isEstimated: false,
        mediaType: loc?.mediaType ?? MediaType.IMAGE,
        creationTime: loc?.creationTime ?? null,
      });
    }
    // Newest first, so the story opens on the most recent memory here.
    result.sort((a, b) => (b.creationTime ?? 0) - (a.creationTime ?? 0));
    return result;
  }, [cluster, assets]);

  const ready = loaded && assets != null;

  return (
    <View style={styles.overlay}>
      {!ready ? (
        <View style={styles.center}>
          <ActivityIndicator color={Ink} />
        </View>
      ) : items.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.empty}>These photos are no longer available.</Text>
        </View>
      ) : (
        <Viewer
          items={items}
          startIndex={0}
          isActive={isActive}
          onClose={onBack}
          tapToAdvance
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  // Transparent so a Viewer swipe-down dismiss reveals the Near Me grid
  // underneath rather than a black screen.
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 20,
  },
  center: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    backgroundColor: Paper,
  },
  empty: {
    fontFamily: DisplayFont,
    color: Ink,
    fontSize: 15,
    textAlign: 'center',
  },
});
