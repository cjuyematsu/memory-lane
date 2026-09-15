import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';

import * as Location from 'expo-location';
import { Asset } from 'expo-media-library';
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';

import { useAssetFeed } from '@/hooks/use-asset-feed';
import {
  setNotificationsEnabled,
  useNotificationSettings,
} from '@/hooks/use-notification-settings';
import { ensureClusters, invalidateClusters } from '@/hooks/use-photo-clusters';
import { withTimeoutDefault } from '@/lib/async-safety';
import { getPosition } from '@/lib/demo-mode';
import { LOCATION_PERM_MS } from '@/lib/loading-timeouts';
import { shouldDegradeNotifications } from '@/lib/notification-degrade';
import {
  shouldRotateGeofences,
  startForegroundFallback,
  startOrRefreshGeofences,
  stopForegroundFallback,
  stopGeofencingIfActive,
} from '@/lib/geofence-manager';
import { setPendingCluster } from '@/lib/pending-cluster';

function openCluster(clusterId: string) {
  setPendingCluster(clusterId);
}

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
    // Cold start: the app may have been launched by tapping a notification.
    // Clear it after handling so a normal relaunch doesn't re-open the same
    // cluster (getLastNotificationResponseAsync otherwise keeps returning it).
    Notifications.getLastNotificationResponseAsync().then((response) => {
      if (!active) return;
      const id = clusterIdFromResponse(response);
      if (id) openCluster(id);
      Notifications.clearLastNotificationResponseAsync().catch(() => {});
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

  // Degrade an "enabled" flag the OS can't honor: Android Auto Backup used to
  // restore the settings file + the registered geofence task onto a reinstall
  // whose permissions were reset, and the restored task's boot-time start made
  // a no-gesture permission request Android filters and never answers —
  // wedging every later permission read (the feed then sat on its loading
  // Polaroid forever). Backup is now off (app.json allowBackup=false), but any
  // device already carrying restored state — or a user who revoked both
  // permissions in system Settings — still needs the flag switched off so
  // nothing background-ish runs unpermissioned. Runs independently of
  // `hasAssets`: this state has no media permission, so assets never load.
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    (async () => {
      // A failed/timed-out read resolves `null` (unknown) — the pure gate
      // treats only a confirmed "not granted" pair as degradable, so a cold
      // OS framework at launch can never silently flip the user's setting.
      const notifGranted = await withTimeoutDefault<boolean | null>(
        Notifications.getPermissionsAsync().then((p) => p.granted),
        LOCATION_PERM_MS,
        null
      );
      const backgroundLocationGranted = await withTimeoutDefault<boolean | null>(
        Location.getBackgroundPermissionsAsync().then((p) => p.granted),
        LOCATION_PERM_MS,
        null
      );
      if (cancelled) return;
      if (
        !shouldDegradeNotifications({ enabled, notifGranted, backgroundLocationGranted })
      ) {
        return;
      }
      // Flip the setting first (the geofence effect below reacts by stopping
      // everything), then clear TaskManager's persisted task registrations —
      // the piece a backup restore carries over that would otherwise auto-start
      // again on the next launch.
      setNotificationsEnabled(false);
      TaskManager.unregisterAllTasksAsync().catch(() => {});
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  // Geofence lifecycle. Runs only when enabled AND we have assets — fetches
  // location imperatively (no always-on useCurrentLocation hook) and only
  // re-registers when the rotation thresholds say so. Re-evaluates on app
  // foreground.
  useEffect(() => {
    if (!enabled) {
      stopGeofencingIfActive().catch(() => {});
      stopForegroundFallback();
      return;
    }
    if (!hasAssets) return;

    let cancelled = false;
    const evaluate = async () => {
      if (cancelled) return;
      try {
        const perm = await Location.getForegroundPermissionsAsync();
        if (perm.status !== 'granted' || cancelled) return;
        const bg = await Location.getBackgroundPermissionsAsync();
        if (cancelled) return;
        if (bg.status !== 'granted') {
          // Without "Always", startGeofencingAsync throws on both platforms —
          // fall back to a foreground-only position watch that surfaces the
          // in-app banner through the same enter pipeline. Build the cluster
          // index first; the watch reads it.
          await ensureClusters(assetsRef.current);
          if (!cancelled) await startForegroundFallback();
          return;
        }
        stopForegroundFallback(); // upgraded to Always — geofencing takes over
        const pos = await getPosition({ accuracy: Location.Accuracy.Balanced });
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
      // The When-In-Use watch stops delivering in the background anyway; drop
      // it eagerly and let the next foreground re-create it.
      else stopForegroundFallback();
    });
    return () => {
      cancelled = true;
      sub.remove();
      stopForegroundFallback();
    };
  }, [enabled, hasAssets]);

  return null;
}
