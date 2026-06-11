import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import BellIcon from '@/assets/icons/bell.svg';
import { frameTop } from '@/components/feed/photo-frame';
import { ClusterView } from '@/components/near-me/cluster-view';
import { Grid } from '@/components/near-me/grid';
import { Viewer } from '@/components/near-me/viewer';
import { SettingsSheet } from '@/components/notifications/settings-sheet';
import { DisplayFont, FrameMargin, Ink, Paper } from '@/constants/theme';
import { setPendingCluster, usePendingCluster } from '@/lib/pending-cluster';
import { useAssetFeed } from '@/hooks/use-asset-feed';
import { useCurrentLocation } from '@/hooks/use-current-location';
import { useMediaPermission } from '@/hooks/use-media-permission';
import {
  refreshNearby,
  useNearbyAssets,
  type NearbyAsset,
} from '@/hooks/use-nearby-assets';

export function NearMe({
  isActive = true,
  onOpenMemoryFeed,
  onViewerOpenChange,
}: {
  isActive?: boolean;
  onOpenMemoryFeed?: (assetId: string) => void;
  // Fires when a photo is opened/closed full-screen from the grid, so the
  // parent can hide the top tabs (and disable tab swiping) for a clean view.
  onViewerOpenChange?: (open: boolean) => void;
} = {}) {
  const insets = useSafeAreaInsets();
  // Align the grid's top with the Camera Roll photo frame so the side swipe
  // between tabs lines up.
  const gridPaddingTop = frameTop(insets.top);
  const [mediaPermission, requestMediaPermission] = useMediaPermission();
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

  useEffect(() => {
    onViewerOpenChange?.(viewerIndex !== null);
  }, [viewerIndex, onViewerOpenChange]);

  // Floats at the lower-right of the grid as a white pill with a dark bell, so
  // it stays obvious over the photos and matches the gallery theme.
  const notificationsButton = (
    <Pressable
      onPress={() => setSettingsOpen(true)}
      style={[styles.notificationsBtn, { bottom: insets.bottom + 16, right: FrameMargin + 6 }]}
      hitSlop={12}>
      <BellIcon width={22} height={22} fill={Ink} />
    </Pressable>
  );

  const settingsSheet = (
    <SettingsSheet visible={settingsOpen} onClose={() => setSettingsOpen(false)} />
  );

  if (!mediaPermission) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={Ink} />
      </View>
    );
  }

  if (!mediaPermission.granted) {
    // Once denied, requestMediaPermission() is a silent no-op — send to Settings.
    const canAsk = mediaPermission.canAskAgain;
    return (
      <SafeAreaView style={styles.center}>
        <Text style={styles.title}>Near Me</Text>
        <Text style={styles.body}>We need access to your photos.</Text>
        <Pressable
          style={styles.button}
          onPress={() => (canAsk ? requestMediaPermission() : Linking.openSettings())}>
          <Text style={styles.buttonLabel}>{canAsk ? 'Grant access' : 'Open Settings'}</Text>
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
          <Pressable
            style={styles.button}
            onPress={() =>
              locationState.canAskAgain ? refreshLocation() : Linking.openSettings()
            }>
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
          <ActivityIndicator color={Ink} />
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
        paddingBottom={insets.bottom}
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
        <ActivityIndicator color={Ink} />
      </View>
    );
  })();

  return (
    <View style={styles.container}>
      {body}

      {viewerIndex !== null && items.length > 0 && (
        <Viewer
          items={items}
          startIndex={Math.max(0, Math.min(viewerIndex, items.length - 1))}
          isActive={isActive}
          onClose={() => setViewerIndex(null)}
          onOpenMemoryFeed={onOpenMemoryFeed}
        />
      )}

      {/* Hide the bell while memories or a full-screen photo are open (it would
          otherwise float over them via its zIndex). */}
      {!pendingCluster && viewerIndex === null ? notificationsButton : null}
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
    backgroundColor: Paper,
  },
  center: {
    flex: 1,
    backgroundColor: Paper,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    paddingHorizontal: 24,
  },
  title: {
    fontFamily: DisplayFont,
    color: Ink,
    fontSize: 32,
    textTransform: 'uppercase',
    textAlign: 'center',
  },
  body: {
    fontFamily: DisplayFont,
    color: Ink,
    fontSize: 15,
    textAlign: 'center',
  },
  button: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 32,
    backgroundColor: Ink,
  },
  buttonLabel: {
    fontFamily: DisplayFont,
    color: Paper,
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
    fontFamily: DisplayFont,
    color: Ink,
    fontSize: 22,
    textTransform: 'uppercase',
  },
  emptySub: {
    color: '#777',
    fontSize: 14,
    textAlign: 'center',
  },
  notificationsBtn: {
    position: 'absolute',
    zIndex: 10,
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Paper,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 5,
  },
});
