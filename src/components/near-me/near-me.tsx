import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { usePermissions } from 'expo-media-library';

import { Grid } from '@/components/near-me/grid';
import { Viewer } from '@/components/near-me/viewer';
import { Colors, BottomTabInset } from '@/constants/theme';
import { useAssetFeed } from '@/hooks/use-asset-feed';
import { useCurrentLocation } from '@/hooks/use-current-location';
import {
  PHOTO_RADIUS_METERS,
  VIDEO_RADIUS_METERS,
  refreshNearby,
  useNearbyAssets,
} from '@/hooks/use-nearby-assets';

type Tab = 'photos' | 'videos';

export function NearMe() {
  const [mediaPermission, requestMediaPermission] = usePermissions();
  const granted = !!mediaPermission?.granted;
  const { state: feedState, reload: reloadFeed } = useAssetFeed(granted);
  const { state: locationState, refresh: refreshLocation } = useCurrentLocation();

  const assets = feedState.status === 'ready' ? feedState.assets : null;
  const origin = locationState.status === 'ready' ? locationState.coords : null;
  const nearby = useNearbyAssets(assets, origin);

  const [tab, setTab] = useState<Tab>('photos');
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
  const progress =
    nearby.total > 0 ? Math.min(100, Math.round((nearby.scanned / nearby.total) * 100)) : 0;

  const items = tab === 'photos' ? nearby.photos : nearby.videos;
  const radius = tab === 'photos' ? PHOTO_RADIUS_METERS : VIDEO_RADIUS_METERS;
  const subtitle = isScanning
    ? `scanning ${progress}% · ${items.length} found`
    : `${items.length} within ${radius}m`;

  return (
    <View style={styles.container}>
      <SafeAreaView edges={['top']} style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>Near Me</Text>
          <Text style={styles.headerSub}>{subtitle}</Text>
        </View>
        <Pressable
          onPress={() => {
            refreshNearby();
            refreshLocation();
          }}
          style={styles.refreshBtn}
          disabled={isScanning}
          hitSlop={8}>
          <Text style={styles.refreshLabel}>refresh</Text>
        </Pressable>
      </SafeAreaView>

      <View style={styles.segmentRow}>
        <SegmentButton
          label={`Photos · ${nearby.photos.length}`}
          active={tab === 'photos'}
          onPress={() => {
            setTab('photos');
            setViewerIndex(null);
          }}
        />
        <SegmentButton
          label={`Videos · ${nearby.videos.length}`}
          active={tab === 'videos'}
          onPress={() => {
            setTab('videos');
            setViewerIndex(null);
          }}
        />
      </View>

      {items.length === 0 && !isScanning ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>Nothing here yet</Text>
          <Text style={styles.emptySub}>
            No {tab} within {radius}m.
          </Text>
        </View>
      ) : (
        <Grid
          items={items}
          onPressItem={(i) => setViewerIndex(i)}
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

function SegmentButton({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.segmentBtn, active && styles.segmentBtnActive]}>
      <Text style={[styles.segmentLabel, active && styles.segmentLabelActive]}>{label}</Text>
    </Pressable>
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
  header: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  headerTitle: {
    color: '#fff',
    fontSize: 24,
    fontWeight: '700',
  },
  headerSub: {
    color: Colors.dark.textSecondary,
    fontSize: 13,
    marginTop: 2,
  },
  refreshBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  refreshLabel: {
    color: '#3c87f7',
    fontSize: 14,
  },
  segmentRow: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingBottom: 10,
    gap: 8,
  },
  segmentBtn: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: Colors.dark.backgroundElement,
  },
  segmentBtnActive: {
    backgroundColor: '#fff',
  },
  segmentLabel: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
  segmentLabelActive: {
    color: '#000',
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    gap: 8,
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
