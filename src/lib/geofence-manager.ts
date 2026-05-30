import { AppState, Platform } from 'react-native';

import * as Location from 'expo-location';
import { Asset } from 'expo-media-library';
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';

import { loadSettingsFromDisk } from '@/hooks/use-notification-settings';
import {
  distanceMeters,
  ensureClusters,
  isClusterNotifiable,
  loadClustersFromDisk,
  nearestNotifiableClusters,
} from '@/hooks/use-photo-clusters';
import { showBanner } from '@/lib/foreground-banner';
import { isInCooldown, markNotified } from '@/lib/notification-cooldown';
import { isSuppressed, recordSurfaced } from '@/lib/notification-engagement';
import { formatTimeAgo } from '@/utils/time-ago';

export const GEOFENCE_TASK_NAME = 'memory-feed-geofence';
export const ANDROID_CHANNEL_ID = 'memories';

const MAX_REGIONS = 20;
const PROXIMITY_RADIUS_METERS = 40;
const ROTATION_DISTANCE_METERS = 500;
const ROTATION_INTERVAL_MS = 6 * 60 * 60 * 1000;

// Foreground notifications are suppressed at the system level — when the app
// is open we show the in-app banner instead (Phase 7). Backgrounded/killed
// notifications are shown by the OS and never consult this handler.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: false,
    shouldPlaySound: false,
    shouldSetBadge: false,
    shouldShowBanner: false,
    shouldShowList: false,
  }),
});

async function ensureAndroidChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
    name: 'Memory notifications',
    importance: Notifications.AndroidImportance.DEFAULT,
  });
}

// Self-contained so it works when the task runs headless (app killed): reads
// settings, clusters, and cooldown from disk rather than any React/in-memory
// state that wouldn't exist in a cold background process.
async function handleClusterEnter(clusterId: string): Promise<void> {
  const settings = await loadSettingsFromDisk();
  if (!settings.enabled) return;

  const clusters = await loadClustersFromDisk();
  const cluster = clusters?.find((c) => c.id === clusterId);
  if (!cluster || !isClusterNotifiable(cluster)) return;

  if (await isInCooldown(clusterId)) return;
  // Skip places the user keeps ignoring.
  if (await isSuppressed(clusterId)) return;

  if (AppState.currentState === 'active') {
    // Foreground: show the in-app banner instead of a system notification.
    showBanner({ clusterId, count: cluster.assetIds.length });
  } else {
    await ensureAndroidChannel();
    await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Memory nearby',
        body: `You took something here ${formatTimeAgo(cluster.oldestCreationTime)}`,
        data: { clusterId },
      },
      trigger: null,
    });
  }
  await markNotified(clusterId);
  await recordSurfaced(clusterId);
}

// Dev-only: fire the same notification path on a short delay so the app can
// be backgrounded to actually see it (foreground presentation is suppressed).
// If a notifiable cluster exists, the test notification carries its id so
// tapping it exercises the real tap -> filtered Near Me routing.
export async function fireTestNotification(): Promise<void> {
  await ensureAndroidChannel();
  const clusters = await loadClustersFromDisk();
  const cluster = clusters?.find((c) => isClusterNotifiable(c));
  await Notifications.scheduleNotificationAsync({
    content: {
      title: 'Memory nearby',
      body: cluster
        ? `You took something here ${formatTimeAgo(cluster.oldestCreationTime)}`
        : 'Test notification — your notification setup works.',
      data: cluster ? { clusterId: cluster.id } : { test: true },
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
      seconds: 4,
    },
  });
}

TaskManager.defineTask(GEOFENCE_TASK_NAME, async ({ data, error }) => {
  if (error) {
    // eslint-disable-next-line no-console
    console.warn('Geofence task error', error);
    return;
  }
  const event = data as {
    eventType: Location.GeofencingEventType;
    region: Location.LocationRegion;
  };
  if (event.eventType !== Location.GeofencingEventType.Enter) return;
  const id = event.region?.identifier;
  if (!id) return;
  await handleClusterEnter(id);
});

// Tracks the location/time at which we last picked the active region set, so
// we only re-register when the user has moved meaningfully or enough time
// has passed. Keeping this in module state (not state.json) is fine — the OS
// keeps the registered regions persisted itself, and we re-evaluate
// proactively on app foreground.
let lastEvaluatedLat: number | null = null;
let lastEvaluatedLng: number | null = null;
let lastEvaluatedAt: number = 0;

export function shouldRotateGeofences(
  lat: number,
  lng: number,
  now: number = Date.now()
): boolean {
  if (lastEvaluatedLat == null || lastEvaluatedLng == null) return true;
  if (now - lastEvaluatedAt > ROTATION_INTERVAL_MS) return true;
  return (
    distanceMeters(lat, lng, lastEvaluatedLat, lastEvaluatedLng) >
    ROTATION_DISTANCE_METERS
  );
}

export async function startOrRefreshGeofences(
  lat: number,
  lng: number,
  assets: Asset[]
): Promise<void> {
  await ensureClusters(assets);
  const nearest = nearestNotifiableClusters(lat, lng, MAX_REGIONS);
  if (nearest.length === 0) {
    await stopGeofencingIfActive();
    return;
  }
  const regions: Location.LocationRegion[] = nearest.map((c) => ({
    identifier: c.id,
    latitude: c.centerLat,
    longitude: c.centerLng,
    radius: PROXIMITY_RADIUS_METERS,
    notifyOnEnter: true,
    notifyOnExit: false,
  }));
  await Location.startGeofencingAsync(GEOFENCE_TASK_NAME, regions);
  lastEvaluatedLat = lat;
  lastEvaluatedLng = lng;
  lastEvaluatedAt = Date.now();
}

export async function stopGeofencingIfActive(): Promise<void> {
  const isRegistered = await TaskManager.isTaskRegisteredAsync(
    GEOFENCE_TASK_NAME
  );
  if (!isRegistered) return;
  try {
    await Location.stopGeofencingAsync(GEOFENCE_TASK_NAME);
  } catch {
    // ignore — task may not actually be running
  }
}

export function resetEvaluation(): void {
  lastEvaluatedLat = null;
  lastEvaluatedLng = null;
  lastEvaluatedAt = 0;
}
