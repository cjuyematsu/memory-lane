import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { usePermissions } from 'expo-media-library';

import BellIcon from '@/assets/icons/bell.svg';
import { ClusterView } from '@/components/near-me/cluster-view';
import { Grid } from '@/components/near-me/grid';
import { Viewer } from '@/components/near-me/viewer';
import { SettingsSheet } from '@/components/notifications/settings-sheet';
import { Colors, BottomTabInset } from '@/constants/theme';
import { setPendingCluster, usePendingCluster } from '@/lib/pending-cluster';
import { useAssetFeed } from '@/hooks/use-asset-feed';
import { useCurrentLocation } from '@/hooks/use-current-location';
import {
  refreshNearby,
  useNearbyAssets,
  type NearbyAsset,
} from '@/hooks/use-nearby-assets';

const TAB_BAR_HEIGHT = 46;

export function NearMe({
  isActive = true,
  onOpenMemoryFeed,
}: {
  isActive?: boolean;
  onOpenMemoryFeed?: (assetId: string) => void;
} = {}) {
  const insets = useSafeAreaInsets();
  const gridPaddingTop = insets.top + TAB_BAR_HEIGHT + 8;
  const [mediaPermission, requestMediaPermission] = usePermissions();
  const granted = !!mediaPermission?.granted;
  const { state: feedState, reload: reloadFeed } = useAssetFeed(granted);
  const { state: locationState, refresh: refreshLocation } = useCurrentLocation();

  const assets = feedState.status === 'ready' ? feedState.assets : null;
  const origin = locationState.status === 'ready' ? locationState.coords : null;
  const nearby = useNearbyAssets(assets, origin);

  const items: NearbyAsset[] = useMemo(() => {
    const merged = [...nearby.photos, ...nearby.videos];
    // Sort by recency, not distance. The scan surfaces matches newest-first,
    // so a creation-time sort means progressively-found photos append at the
    // bottom instead of shuffling to the front (which a distance sort caused).
    merged.sort((a, b) => (b.creationTime ?? 0) - (a.creationTime ?? 0));
    return merged;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nearby.photos.length, nearby.videos.length, nearby.status]);

  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const pendingCluster = usePendingCluster();

  const notificationsButton = (
    <SafeAreaView
      style={styles.notificationsWrap}
      edges={['top']}
      pointerEvents="box-none">
      <Pressable
        onPress={() => setSettingsOpen(true)}
        style={styles.notificationsBtn}
        hitSlop={12}>
        <BellIcon width={20} height={20} fill="#fff" />
      </Pressable>
    </SafeAreaView>
  );

  const settingsSheet = (
    <SettingsSheet visible={settingsOpen} onClose={() => setSettingsOpen(false)} />
  );

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

  // The normal Near Me body. Rendered underneath the memories cluster view so
  // that swiping the cluster view away reveals this instead of a black screen.
  const body = (() => {
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
    // Stable order thanks to the recency sort. Spinner only while we have
    // nothing yet and the scan is still running; empty state only once the
    // scan is fully done with no matches.
    return items.length > 0 ? (
      <Grid
        items={items}
        onPressItem={(i) => setViewerIndex(i)}
        paddingTop={gridPaddingTop}
        paddingBottom={BottomTabInset + 24}
      />
    ) : nearby.status === 'ready' ? (
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
      <View style={styles.center}>
        <ActivityIndicator color="#fff" />
      </View>
    );
  })();

  return (
    <View style={styles.container}>
      {body}

      {viewerIndex !== null && (
        <Viewer
          items={items}
          startIndex={Math.min(viewerIndex, items.length - 1)}
          isActive={isActive}
          onClose={() => setViewerIndex(null)}
          onOpenMemoryFeed={onOpenMemoryFeed}
        />
      )}

      {/* Hide the bell while memories are open (it would otherwise float over
          the cluster overlay via its zIndex). */}
      {!pendingCluster ? notificationsButton : null}
      {settingsSheet}

      {/* Memories cluster view: a tapped notification routes here. Rendered as
          an overlay on top of the normal Near Me so its right-swipe-to-close
          reveals the grid above instead of a black screen. */}
      {pendingCluster ? (
        <ClusterView
          clusterId={pendingCluster}
          assets={assets}
          isActive={isActive}
          onBack={() => setPendingCluster(null)}
        />
      ) : null}
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
  notificationsWrap: {
    position: 'absolute',
    top: 0,
    right: 0,
    zIndex: 10,
  },
  notificationsBtn: {
    margin: 8,
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
});
