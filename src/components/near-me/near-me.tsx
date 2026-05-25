import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { usePermissions } from 'expo-media-library';

import { Grid } from '@/components/near-me/grid';
import { Viewer } from '@/components/near-me/viewer';
import { Colors, BottomTabInset } from '@/constants/theme';
import { useAssetFeed } from '@/hooks/use-asset-feed';
import { useCurrentLocation } from '@/hooks/use-current-location';
import {
  refreshNearby,
  useNearbyAssets,
  type NearbyAsset,
} from '@/hooks/use-nearby-assets';

const TOP_BAR_INSET = 56;

export function NearMe() {
  const [mediaPermission, requestMediaPermission] = usePermissions();
  const granted = !!mediaPermission?.granted;
  const { state: feedState, reload: reloadFeed } = useAssetFeed(granted);
  const { state: locationState, refresh: refreshLocation } = useCurrentLocation();

  const assets = feedState.status === 'ready' ? feedState.assets : null;
  const origin = locationState.status === 'ready' ? locationState.coords : null;
  const nearby = useNearbyAssets(assets, origin);

  const items: NearbyAsset[] = useMemo(() => {
    const merged = [...nearby.photos, ...nearby.videos];
    merged.sort((a, b) => a.distance - b.distance);
    return merged;
  }, [nearby.photos, nearby.videos]);

  const [viewerIndex, setViewerIndex] = useState<number | null>(null);

  if (!mediaPermission) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#fff" />
      </View>
    );
  }

  if (!mediaPermission.granted) {
    return (
      <SafeAreaView style={styles.center}>
        <Text style={styles.title}>Near Me</Text>
        <Text style={styles.body}>We need access to your photos.</Text>
        <Pressable style={styles.button} onPress={requestMediaPermission}>
          <Text style={styles.buttonLabel}>Grant access</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  if (locationState.status === 'denied') {
    return (
      <SafeAreaView style={styles.center}>
        <Text style={styles.title}>Near Me</Text>
        <Text style={styles.body}>
          Location access is needed to surface photos taken near you.
        </Text>
        <Pressable style={styles.button} onPress={refreshLocation}>
          <Text style={styles.buttonLabel}>
            {locationState.canAskAgain ? 'Try again' : 'Open Settings'}
          </Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  if (locationState.status === 'error') {
    return (
      <SafeAreaView style={styles.center}>
        <Text style={styles.body}>{locationState.message}</Text>
        <Pressable style={styles.button} onPress={refreshLocation}>
          <Text style={styles.buttonLabel}>Retry</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  if (
    locationState.status === 'idle' ||
    locationState.status === 'requesting' ||
    feedState.status === 'idle' ||
    feedState.status === 'loading'
  ) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#fff" />
      </View>
    );
  }

  if (feedState.status === 'error') {
    return (
      <SafeAreaView style={styles.center}>
        <Text style={styles.body}>{feedState.message}</Text>
        <Pressable style={styles.button} onPress={() => reloadFeed()}>
          <Text style={styles.buttonLabel}>Retry</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  const isScanning = nearby.status === 'scanning';

  return (
    <View style={styles.container}>
      {items.length === 0 && !isScanning ? (
        <SafeAreaView style={styles.empty}>
          <Text style={styles.emptyTitle}>Nothing here yet</Text>
          <Text style={styles.emptySub}>No photos or videos nearby.</Text>
          <Pressable
            onPress={() => {
              refreshNearby();
              refreshLocation();
            }}
            style={styles.button}>
            <Text style={styles.buttonLabel}>Refresh</Text>
          </Pressable>
        </SafeAreaView>
      ) : (
        <Grid
          items={items}
          onPressItem={(i) => setViewerIndex(i)}
          paddingTop={TOP_BAR_INSET}
          paddingBottom={BottomTabInset + 24}
        />
      )}

      {viewerIndex !== null && (
        <Viewer
          items={items}
          startIndex={Math.min(viewerIndex, items.length - 1)}
          onClose={() => setViewerIndex(null)}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.dark.background,
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
    fontSize: 36,
    fontWeight: '600',
  },
  body: {
    color: '#fff',
    fontSize: 15,
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
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    gap: 12,
  },
  emptyTitle: {
    color: '#fff',
    fontSize: 22,
    fontWeight: '600',
  },
  emptySub: {
    color: Colors.dark.textSecondary,
    fontSize: 14,
    textAlign: 'center',
  },
});
