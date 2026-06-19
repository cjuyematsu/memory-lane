import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import BellIcon from '@/assets/icons/bell.svg';
import RefreshIcon from '@/assets/icons/refresh.svg';
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
  mergeNearbyByRecency,
  refreshNearby,
  useNearbyAssets,
  type NearbyAsset,
} from '@/hooks/use-nearby-assets';

// The grid renders a frozen snapshot; a stable empty array keeps the memoized
// Grid from re-rendering before the first real snapshot lands.
const EMPTY: NearbyAsset[] = [];
// How long after a refresh trigger we keep adopting freshly-computed results
// before freezing again — covers the GPS fix + 300ms feed debounce + index sync.
const SETTLE_MS = 600;

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

  // Merge photos + videos newest-first.
  const itemsRaw: NearbyAsset[] = useMemo(
    () => mergeNearbyByRecency(nearby.photos, nearby.videos),
    [nearby.photos, nearby.videos]
  );
  // Hold a stable array reference while the ordered set of nearby photos is
  // unchanged. A background reload re-runs computeNearby and hands us a fresh
  // array every time; without this, the grid would receive new data and
  // repaint every tile on each MediaLibrary tick (the flicker). The signature
  // is the ordered id list, so the memo only yields a new array when the actual
  // contents/order change — and even then, unchanged tiles keep their object
  // identity (reused upstream in computeNearby), so only changed cells redraw.
  const itemsSig = itemsRaw.map((n) => n.asset.id).join('|');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const items: NearbyAsset[] = useMemo(() => itemsRaw, [itemsSig]);

  // --- Frozen display snapshot ------------------------------------------------
  // The grid shows a snapshot of `items`, refreshed only on (1) first load,
  // (2) app foreground, and (3) an explicit user refresh — never on passive
  // library changes (a photo taken/deleted while the app is open). The live
  // `useNearbyAssets` above keeps running on LIVE assets, so the shared located
  // index that the geofence notifications read stays current; we freeze only
  // what's displayed.
  const [displayItems, setDisplayItems] = useState<NearbyAsset[] | null>(null);
  // `accepting` opens a short window (after a trigger) during which we adopt each
  // freshly-settled `items` into the snapshot; outside it the grid is frozen.
  const [accepting, setAccepting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  // Token guards the settle timer so overlapping refreshes extend the window and a
  // stale timer only closes the window it opened.
  const acceptSeq = useRef(0);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const arm = useCallback(() => {
    const token = (acceptSeq.current += 1);
    setAccepting(true);
    if (settleTimer.current) clearTimeout(settleTimer.current);
    settleTimer.current = setTimeout(() => {
      if (acceptSeq.current === token) {
        setAccepting(false);
        setRefreshing(false);
      }
    }, SETTLE_MS);
  }, []);

  // Adopt the live list into the snapshot during render — React's supported way to
  // derive state from changing inputs (no effect, so no cascading-render warning).
  // Seed the first time data is ready, then only while a refresh window is open.
  // The `displayItems !== items` guard makes it self-terminating; when the window
  // is closed, passive library recomputes hand us a new `items` we simply ignore.
  if (nearby.status === 'ready' && displayItems !== items && (accepting || displayItems === null)) {
    setDisplayItems(items);
  }

  // Re-fetch on app foreground ("open the app") — re-snapshot, no spinner.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') {
        refreshLocation();
        arm();
      }
    });
    return () => sub.remove();
  }, [arm, refreshLocation]);

  // Clear any pending settle timer on unmount.
  useEffect(() => {
    return () => {
      if (settleTimer.current) clearTimeout(settleTimer.current);
    };
  }, []);

  // Explicit user refresh (pull-to-refresh, the refresh pill, and the empty-state
  // button all route here): refetch location + library, rebuild the index, and
  // adopt the fresh result while the settle window is open.
  const onUserRefresh = useCallback(() => {
    setRefreshing(true);
    arm();
    refreshLocation();
    refreshNearby();
    void reloadFeed();
  }, [arm, refreshLocation, reloadFeed]);

  // What the grid/viewer actually render: the frozen snapshot (or a stable empty
  // array until the first seed).
  const view = displayItems ?? EMPTY;

  // The photo the viewer is actually showing: seeded on tap, then the viewer
  // reports each swipe back here (once per settled swipe — cheap). So if the
  // viewer ever remounts (e.g. around the memory feed), startIndex restores the
  // photo you were on, not the one you first tapped. null = closed.
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const pendingCluster = usePendingCluster();

  // Derive a boolean so this only fires when the viewer opens/closes, not on
  // every swipe-driven viewerIndex change.
  const viewerOpen = viewerIndex !== null;
  useEffect(() => {
    onViewerOpenChange?.(viewerOpen);
  }, [viewerOpen, onViewerOpenChange]);

  // Stable identity (setViewerIndex is stable) so the memoized Grid isn't
  // re-rendered just because NearMe re-rendered for some unrelated reason.
  const openViewer = useCallback((i: number) => setViewerIndex(i), []);

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

  // Sits just above the bell as a matching pill: a manual refresh for the frozen
  // grid (pull-to-refresh does the same and shares the `refreshing` spinner).
  const refreshButton = (
    <Pressable
      onPress={onUserRefresh}
      style={[styles.notificationsBtn, { bottom: insets.bottom + 16 + 56, right: FrameMargin + 6 }]}
      hitSlop={12}>
      <RefreshIcon width={22} height={22} fill={Ink} />
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
    // Initial load only: before the first snapshot exists, show a centered
    // spinner while permissions/location/feed settle. Once we have a snapshot,
    // a refresh must NOT fall back here — refreshLocation() flips location to
    // 'requesting' synchronously, which would blank the whole grid to white
    // before the photos reload. Instead keep the frozen grid on screen and let
    // the pull-to-refresh spinner (above the photos) indicate the work.
    if (
      displayItems === null &&
      (locationState.status === 'idle' ||
        locationState.status === 'requesting' ||
        feedState.status === 'idle' ||
        feedState.status === 'loading')
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
    // The grid renders the frozen snapshot (`view`). The empty state appears
    // only once we've seeded a snapshot and it's genuinely empty; before the
    // first seed we're still loading, so show the spinner.
    return view.length > 0 ? (
      <Grid
        items={view}
        onPressItem={openViewer}
        paddingTop={gridPaddingTop}
        paddingBottom={insets.bottom}
        onRefresh={onUserRefresh}
        refreshing={refreshing}
      />
    ) : displayItems !== null ? (
      <SafeAreaView style={styles.empty}>
        <Text style={styles.emptyTitle}>Nothing here yet</Text>
        <Text style={styles.emptySub}>No photos or videos nearby.</Text>
        <Pressable onPress={onUserRefresh} style={styles.button}>
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

      {viewerIndex !== null && view.length > 0 && (
        <Viewer
          items={view}
          startIndex={Math.max(0, Math.min(viewerIndex, view.length - 1))}
          isActive={isActive}
          onClose={() => setViewerIndex(null)}
          onOpenMemoryFeed={onOpenMemoryFeed}
          onIndexChange={(i) => setViewerIndex(i)}
        />
      )}

      {/* Hide the bell + refresh pill while memories or a full-screen photo are
          open (they would otherwise float over them via zIndex). */}
      {!pendingCluster && viewerIndex === null ? (
        <>
          {refreshButton}
          {notificationsButton}
        </>
      ) : null}
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
