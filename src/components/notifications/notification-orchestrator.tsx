import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';

import * as Location from 'expo-location';
import { Asset } from 'expo-media-library';
import * as Notifications from 'expo-notifications';

import { useAssetFeed } from '@/hooks/use-asset-feed';
import { useNotificationSettings } from '@/hooks/use-notification-settings';
import {
  ensureClusters,
  getClusters,
  invalidateClusters,
  isClusterNotifiable,
} from '@/hooks/use-photo-clusters';
import {
  shouldRotateGeofences,
  startOrRefreshGeofences,
  stopGeofencingIfActive,
} from '@/lib/geofence-manager';
import { recordEngaged } from '@/lib/notification-engagement';
import { setPendingCluster } from '@/lib/pending-cluster';

function openCluster(id: string) {
  recordEngaged(id);
  setPendingCluster(id);
}

// DEV ONLY: fires once per JS session so the cluster view auto-opens on
// launch for UI iteration. Remove before shipping.
let devPreviewShown = false;

function clusterIdFromResponse(
  response: Notifications.NotificationResponse | null
): string | null {
  const data = response?.notification.request.content.data;
  const id = data?.clusterId;
  return typeof id === 'string' ? id : null;
}

/**
 * Renderless component driving the background-notification side of the app.
 *
 * Fully gated on `enabled`: when notifications are off it does no location
 * requests, no asset reloads, and no clustering, so it can't interfere with
 * the rest of the app (e.g. the Near Me scan).
 */
export function NotificationOrchestrator() {
  const { enabled } = useNotificationSettings();
  const { state: feedState } = useAssetFeed(enabled);
  const assetsRef = useRef<Asset[]>([]);
  const prevAssetsRef = useRef<unknown>(null);

  const hasAssets = feedState.status === 'ready' && feedState.assets.length > 0;

  // Notification taps route to the Near Me cluster view. Handled regardless of
  // the enabled flag so a tap always works, and covers cold start (app
  // launched by tapping the notification) plus warm taps.
  useEffect(() => {
    let active = true;
    Notifications.getLastNotificationResponseAsync().then((response) => {
      if (!active) return;
      const id = clusterIdFromResponse(response);
      if (id) openCluster(id);
    });
    const sub = Notifications.addNotificationResponseReceivedListener(
      (response) => {
        const id = clusterIdFromResponse(response);
        if (id) openCluster(id);
      }
    );
    return () => {
      active = false;
      sub.remove();
    };
  }, []);

  // Track the latest assets in a ref (so the geofence effect doesn't re-run
  // on every reload) and invalidate the cluster cache when the library
  // actually changes.
  useEffect(() => {
    if (feedState.status !== 'ready') return;
    assetsRef.current = feedState.assets;
    if (prevAssetsRef.current && prevAssetsRef.current !== feedState.assets) {
      invalidateClusters();
    }
    prevAssetsRef.current = feedState.assets;
  }, [feedState]);

  // DEV ONLY: auto-open a cluster on launch so the cluster-view UI can be
  // iterated without firing a real geofence. Fires once per JS session.
  useEffect(() => {
    if (!__DEV__ || devPreviewShown) return;
    if (feedState.status !== 'ready' || feedState.assets.length === 0) return;
    devPreviewShown = true;
    (async () => {
      await ensureClusters(feedState.assets);
      const clusters = getClusters();
      const target = clusters?.find(isClusterNotifiable) ?? clusters?.[0];
      if (target) setPendingCluster(target.id);
    })();
  }, [feedState]);

  // Geofence lifecycle. Runs only when enabled AND we have assets — fetches
  // location imperatively (no always-on useCurrentLocation hook) and only
  // re-registers when the rotation thresholds say so. Re-evaluates on app
  // foreground.
  useEffect(() => {
    if (!enabled) {
      stopGeofencingIfActive().catch(() => {});
      return;
    }
    if (!hasAssets) return;

    let cancelled = false;
    const evaluate = async () => {
      if (cancelled) return;
      try {
        const perm = await Location.getForegroundPermissionsAsync();
        if (perm.status !== 'granted' || cancelled) return;
        const pos = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        if (cancelled) return;
        const { latitude, longitude } = pos.coords;
        if (!shouldRotateGeofences(latitude, longitude)) return;
        await startOrRefreshGeofences(latitude, longitude, assetsRef.current);
      } catch {
        // best-effort; the orchestrator should never throw into the tree
      }
    };

    evaluate();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') evaluate();
    });
    return () => {
      cancelled = true;
      sub.remove();
    };
  }, [enabled, hasAssets]);

  return null;
}
