import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { LoadingPolaroid } from '@/components/brand/loading-polaroid';
import { frameTop } from '@/components/feed/photo-frame';
import { ClusterView } from '@/components/near-me/cluster-view';
import { Grid } from '@/components/near-me/grid';
import { SetupNote } from '@/components/near-me/setup-note';
import { Viewer } from '@/components/near-me/viewer';
import { DisplayFont, Ink, InkMuted, Paper } from '@/constants/theme';
import { markDecodeBurst } from '@/lib/decode-burst';
import { subscribeNearMeRequest } from '@/lib/near-me-request';
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
// Minimum time a refresh reads as "busy" after a tap — drives the empty-state
// "Searching…" view. The recompute can settle near-instantly (nothing nearby /
// same library), so without a floor the tap would read as a no-op; this
// guarantees the search feels like it actually ran.
const BUSY_MIN_MS = 1200;
// How long Near Me can sit on the loading spinner before we surface the
// "Setting up" note. Short enough that a genuinely slow first build (large /
// iCloud-offloaded library) explains itself, long enough that fast/warm launches
// never flash it.
const SLOW_NOTE_DELAY_MS = 2000;
// If the cold-load polaroid is STILL up after this long, something upstream
// stalled (feed hook, location, index build) — surface a manual Retry escape
// instead of trusting the internal timeouts to always terminate.
const STUCK_RETRY_DELAY_MS = 30000;

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
  // After a beat on the loading spinner with no snapshot yet, reveal the
  // "Setting up Near Me" note (the slow first build is the only thing that keeps
  // us here this long).
  const [showSlowNote, setShowSlowNote] = useState(false);
  const [showStuckRetry, setShowStuckRetry] = useState(false);
  // `accepting` opens a short window (after a trigger) during which we adopt each
  // freshly-settled `items` into the snapshot; outside it the grid is frozen.
  const [accepting, setAccepting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  // True while a user-triggered refresh is visibly in progress. Drives the
  // empty-state "Searching…" view — the feedback the RefreshControl spinner
  // can't give when there's no grid to pull (and the always-present side pill
  // routes here too, so tapping it in the empty state shows that screen).
  // Latched for at least BUSY_MIN_MS so a refresh always reads as work.
  const [busy, setBusy] = useState(false);
  // Token guards the settle timer so overlapping refreshes extend the window and a
  // stale timer only closes the window it opened.
  const acceptSeq = useRef(0);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const busyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Remembers whether the last *resolved* location check found location
  // unavailable. A refresh flips location through 'requesting' (which has no
  // identity of its own), so this lets us tell "refreshing a known-off location"
  // (show "Searching for location…", not the stale grid) from a normal refresh
  // (keep the photos). Sticky across 'requesting'/'idle'; only 'ready' clears it.
  // Adjusted during render (guarded, self-terminating) — same supported pattern
  // as the displayItems snapshot below, so no effect / no ref-in-render.
  const [locationWasUnavailable, setLocationWasUnavailable] = useState(false);
  if (
    (locationState.status === 'denied' || locationState.status === 'error') &&
    !locationWasUnavailable
  ) {
    setLocationWasUnavailable(true);
  } else if (locationState.status === 'ready' && locationWasUnavailable) {
    setLocationWasUnavailable(false);
  }

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

  // Adopting a snapshot fans out a dozen simultaneous ph:// grid decodes; mark
  // the decode burst so the located-index sweep down-shifts and defers its
  // checkpoint writes instead of peaking alongside them (the June 30 field
  // crash was this collision at the ~8s GPS-fix boundary on a warm launch).
  useEffect(() => {
    if (displayItems && displayItems.length > 0) markDecodeBurst();
  }, [displayItems]);

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

  // Reveal the setup note only after the spinner has lingered (= a slow first
  // build); never flash it on fast loads. `displayItems` only ever goes
  // null -> array (a snapshot is never cleared back to null), so once we have one
  // the early-return cancels the timer and the note unmounts with the spinner —
  // no reset-to-false needed (which would trip react-hooks/set-state-in-effect).
  useEffect(() => {
    if (displayItems !== null) return;
    const t = setTimeout(() => setShowSlowNote(true), SLOW_NOTE_DELAY_MS);
    return () => clearTimeout(t);
  }, [displayItems]);

  // Escape hatch for a wedged cold load. Tapping Retry resets the flag, which
  // re-runs this effect and re-arms a fresh 30s window for the new attempt.
  useEffect(() => {
    if (displayItems !== null || showStuckRetry) return;
    const t = setTimeout(() => setShowStuckRetry(true), STUCK_RETRY_DELAY_MS);
    return () => clearTimeout(t);
  }, [displayItems, showStuckRetry]);

  // Clear any pending timers on unmount.
  useEffect(() => {
    return () => {
      if (settleTimer.current) clearTimeout(settleTimer.current);
      if (busyTimer.current) clearTimeout(busyTimer.current);
    };
  }, []);

  // Explicit user refresh (pull-to-refresh, the refresh pill, and the empty-state
  // button all route here): refetch location + library, rebuild the index, and
  // adopt the fresh result while the settle window is open. Also latches `busy`
  // for a minimum beat so an empty-state refresh (pill or middle button) shows
  // the "Searching…" screen even when work settles instantly — otherwise the
  // tap reads as a no-op.
  const onUserRefresh = useCallback(() => {
    setRefreshing(true);
    setBusy(true);
    if (busyTimer.current) clearTimeout(busyTimer.current);
    busyTimer.current = setTimeout(() => setBusy(false), BUSY_MIN_MS);
    arm();
    void refreshLocation();
    void refreshNearby();
    void reloadFeed();
  }, [arm, refreshLocation, reloadFeed]);

  // A banner tap (the foreground memory banner or the app-open greeter) routes
  // here via requestNearMe — TopTabs switches to this tab, and we refresh so the
  // grid recomputes at the current location rather than landing on a stale,
  // frozen snapshot. NearMe is always mounted in the pager, so this fires even
  // when Near Me isn't the active tab.
  useEffect(() => subscribeNearMeRequest(onUserRefresh), [onUserRefresh]);

  // What the grid/viewer actually render: the frozen snapshot (or a stable empty
  // array until the first seed).
  const view = displayItems ?? EMPTY;

  // The photo the viewer is actually showing: seeded on tap, then the viewer
  // reports each swipe back here (once per settled swipe — cheap). So if the
  // viewer ever remounts (e.g. around the memory feed), startIndex restores the
  // photo you were on, not the one you first tapped. null = closed.
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
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

  // Settings moved to the Then & Now tab (like a profile/"you" tab), and the
  // manual refresh pill is gone — pull-to-refresh (and the empty-state button)
  // cover refreshing the frozen grid. So Near Me has no floating controls.

  if (!mediaPermission) {
    return <LoadingPolaroid />;
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

  // Under-polaroid content for the cold-load branches: the setup note once the
  // load is merely slow, plus the manual Retry once it looks wedged.
  const stuckRetryNote = showStuckRetry ? (
    <Pressable
      style={[styles.button, { marginTop: 14 }]}
      onPress={() => {
        setShowStuckRetry(false);
        onUserRefresh();
      }}>
      <Text style={styles.buttonLabel}>Retry</Text>
    </Pressable>
  ) : null;

  // The normal Near Me body. Rendered underneath the memories cluster view so
  // that swiping the cluster view away reveals this instead of a black screen.
  const body = (() => {
    // While an explicit refresh re-checks a location we know is unavailable —
    // either it's resolved to denied/error, or it's mid-'requesting' after a
    // previous failure — show a searching state instead of the location prompt
    // or a stale grid. Mirrors the empty-state "Searching for photos…"; the
    // prompt returns once the check settles. Normal refreshes (location ready)
    // never hit this, so their photos stay on screen.
    const locationUnavailable =
      locationState.status === 'denied' ||
      locationState.status === 'error' ||
      ((locationState.status === 'requesting' || locationState.status === 'idle') &&
        locationWasUnavailable);
    if (busy && locationUnavailable) {
      return (
        <SafeAreaView style={styles.center}>
          <ActivityIndicator color={Ink} />
          <Text style={styles.emptyTitle}>Searching…</Text>
          <Text style={styles.emptySub}>Looking for your location.</Text>
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
      return <LoadingPolaroid note={stuckRetryNote ?? undefined} />;
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
        isActive={isActive}
      />
    ) : displayItems !== null ? (
      <SafeAreaView style={styles.empty}>
        {busy ? (
          <>
            <ActivityIndicator color={Ink} />
            <Text style={styles.emptyTitle}>Searching…</Text>
            <Text style={styles.emptySub}>Looking for photos &amp; videos nearby.</Text>
          </>
        ) : (
          <>
            <Text style={styles.emptyTitle}>Nothing here yet</Text>
            <Text style={styles.emptySub}>No photos or videos nearby.</Text>
            <Pressable onPress={onUserRefresh} style={styles.button}>
              <Text style={styles.buttonLabel}>Refresh</Text>
            </Pressable>
          </>
        )}
      </SafeAreaView>
    ) : (
      <LoadingPolaroid
        note={
          showSlowNote || stuckRetryNote ? (
            <>
              {showSlowNote ? <SetupNote /> : null}
              {stuckRetryNote}
            </>
          ) : undefined
        }
      />
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
    color: InkMuted,
    fontSize: 14,
    textAlign: 'center',
  },
});
