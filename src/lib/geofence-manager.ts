import { AppState, Platform } from 'react-native';

import * as Location from 'expo-location';
import { Asset } from 'expo-media-library';
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';

import { loadSettingsFromDisk } from '@/hooks/use-notification-settings';
import {
  distanceMeters,
  ensureClusters,
  findClusterWithinRadius,
  getClusters,
  isAreaNotifiable,
  isClusterNotifiable,
  loadClustersFromDisk,
  nearestNotifiableClusters,
  type PhotoCluster,
} from '@/hooks/use-photo-clusters';
import { getIndex } from '@/hooks/use-located-assets';
import { nearbyCount } from '@/hooks/use-nearby-assets';
import {
  isClusterInCooldown,
  markClusterNotified,
} from '@/lib/cluster-cooldown';
import { showBanner } from '@/lib/foreground-banner';
import { isInCooldown, markNotified } from '@/lib/notification-cooldown';
import {
  isRoutineLocation,
  recordPresence,
  routineDayCount,
} from '@/lib/place-presence';
import {
  clusterRelevanceRadius,
  COOLDOWN_OPTS,
  NEARME_OPTS,
  relevanceRadiusFor,
  TRIGGER_OPTS,
} from '@/lib/relevance-radius';
import { formatTimeAgo } from '@/utils/time-ago';

export const GEOFENCE_TASK_NAME = 'memory-feed-geofence';
export const ANDROID_CHANNEL_ID = 'memories';

const MAX_REGIONS = 20;
// Geofence region radius is no longer a single constant: it adapts to local
// photo-cluster spacing (TRIGGER_OPTS in @/lib/relevance-radius) so a memory in
// a sparse area triggers from farther, while dense areas clamp to the ~120m
// iOS region-monitoring accuracy floor — unchanged from before.
const ROTATION_DISTANCE_METERS = 500;
const ROTATION_INTERVAL_MS = 6 * 60 * 60 * 1000;
// When there are more notifiable clusters than region slots, one slot becomes
// a "re-anchor boundary": an exit-only region centered on the anchor, sized to
// reach the nearest cluster we couldn't register. Leaving it wakes the task
// (even app-killed) and we re-pick regions around wherever the user is now —
// background rotation without continuous location tracking.
export const BOUNDARY_REGION_ID = '__memory-feed-reanchor__';
// Floor: below this the boundary churns on GPS noise / short walks (the
// clusters it would surface are mostly covered by the registered 19 anyway).
// Ceiling: keeps the radius well inside platform region-size limits; a smaller
// boundary only means an occasional extra (cheap) re-evaluation wake.
const BOUNDARY_MIN_RADIUS_METERS = 500;
const BOUNDARY_MAX_RADIUS_METERS = 25_000;
// Foreground-fallback watch: re-check for a memory after this much movement.
const FALLBACK_DISTANCE_INTERVAL_M = 40;
// Dev test notifications fire after this delay so there's time to background
// the app — foreground notifications are intentionally suppressed (see the
// handler below), so a too-short delay fires while still on screen and shows
// nothing.
const TEST_NOTIFICATION_DELAY_S = 8;

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

async function ensureNotificationPermission(): Promise<boolean> {
  let perm = await Notifications.getPermissionsAsync();
  if (perm.status !== 'granted') {
    perm = await Notifications.requestPermissionsAsync();
  }
  return perm.status === 'granted';
}

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
  // Suppress if you've shot anything nearby in the last ~90 days — treats the
  // surrounding area (home spans several cells) as "recently visited", so home
  // doesn't fire even when its recent photos sit in an adjacent grid cell.
  if (!cluster || !clusters || !isAreaNotifiable(cluster, clusters)) return;

  // Log that you're physically here (every real enter feeds the home/work
  // signal), then bail if this is a routine place — somewhere you keep returning
  // to, like home or the office, should never ping you with a memory.
  await recordPresence(cluster.centerLat, cluster.centerLng);
  if (await isRoutineLocation(cluster.centerLat, cluster.centerLng)) return;

  // This exact place already surfaced its memory recently — the memory is
  // "spent", so stay quiet for the user's chosen window (default ~90 days, up to
  // "Only once" = forever) even as you keep passing through.
  if (await isClusterInCooldown(clusterId, undefined, settings.placeCooldownMs)) return;

  // Short spatial quiet zone: don't let a near-duplicate cluster double-ping on
  // the same arrival. The radius tracks local density too, so suppression and
  // triggering agree — in a sparse area where regions widen, two clusters a few
  // hundred meters apart won't both fire at once.
  const cooldownRadius = clusterRelevanceRadius(cluster, clusters, COOLDOWN_OPTS);
  if (await isInCooldown(cluster.centerLat, cluster.centerLng, undefined, cooldownRadius))
    return;

  if (AppState.currentState === 'active') {
    // Foreground: show the in-app banner instead of a system notification.
    // Count the same way Near Me does (everything within the adaptive Near Me
    // radius around this place), not just this one ~50m cell, so the banner's
    // number matches the grid the tap lands you on. Origin is the cluster center
    // ("where the memory is"); the index is the shared spine Near Me reads, so
    // when it's built the counts line up. Fall back to the cell count on the
    // rare cold-launch where the index isn't ready yet.
    const index = getIndex();
    const count = index
      ? nearbyCount(
          index,
          { latitude: cluster.centerLat, longitude: cluster.centerLng },
          relevanceRadiusFor(cluster.centerLat, cluster.centerLng, clusters, NEARME_OPTS)
        )
      : cluster.assetIds.length;
    showBanner({ kind: 'nearby', count });
  } else {
    await ensureAndroidChannel();
    await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Memory here',
        body: `A photo from ${formatTimeAgo(cluster.oldestCreationTime)}`,
        data: { clusterId },
      },
      // `{ channelId }` delivers immediately (like `null`) but routes through
      // our named Android channel; channelId is ignored on iOS.
      trigger: { channelId: ANDROID_CHANNEL_ID },
    });
  }
  await markNotified(cluster.centerLat, cluster.centerLng);
  await markClusterNotified(clusterId, undefined, settings.placeCooldownMs);
}

// Dev-only: fire the same notification path on a short delay so the app can
// be backgrounded to actually see it (foreground presentation is suppressed).
// If a notifiable cluster exists, the test notification carries its id so
// tapping it exercises the real tap -> filtered Near Me routing.
export async function fireTestNotification(): Promise<boolean> {
  if (!(await ensureNotificationPermission())) return false;
  await ensureAndroidChannel();
  const clusters = await loadClustersFromDisk();
  const cluster = clusters?.find((c) => isClusterNotifiable(c));
  await Notifications.scheduleNotificationAsync({
    content: {
      title: 'Memory nearby',
      body: cluster
        ? `You took a photo here ${formatTimeAgo(cluster.oldestCreationTime)}`
        : 'Test notification: your notification setup works.',
      data: cluster ? { clusterId: cluster.id } : { test: true },
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
      seconds: TEST_NOTIFICATION_DELAY_S,
      channelId: ANDROID_CHANNEL_ID,
    },
  });
  return true;
}

// Dev-only: schedule the real memory notification for the cluster you're
// physically nearest to, ignoring the 90-day rule and cooldown so the full
// notification -> tap -> Near Me cluster flow can be exercised on demand
// without standing at an old-photo location. Fires on a short delay so the app
// can be backgrounded (foreground presentation is suppressed).
export async function triggerNearestMemoryHere(): Promise<{
  ok: boolean;
  message: string;
}> {
  const perm = await Location.getForegroundPermissionsAsync();
  if (perm.status !== 'granted') {
    return { ok: false, message: 'Location permission is needed to find a memory here.' };
  }
  if (!(await ensureNotificationPermission())) {
    return {
      ok: false,
      message: 'Notifications are off. Turn on “Memory notifications” (or allow them in system Settings) first.',
    };
  }
  const clusters = getClusters() ?? (await loadClustersFromDisk());
  if (!clusters || clusters.length === 0) {
    return { ok: false, message: 'No located photos yet. Open Near Me once to build the index.' };
  }
  const pos = await Location.getCurrentPositionAsync({
    accuracy: Location.Accuracy.Balanced,
  });
  const { latitude, longitude } = pos.coords;
  let nearest = clusters[0];
  let nearestDist = Infinity;
  for (const c of clusters) {
    const d = distanceMeters(latitude, longitude, c.centerLat, c.centerLng);
    if (d < nearestDist) {
      nearestDist = d;
      nearest = c;
    }
  }
  await ensureAndroidChannel();
  await Notifications.scheduleNotificationAsync({
    content: {
      title: 'Memory here',
      body: `A photo from ${formatTimeAgo(nearest.oldestCreationTime)}`,
      data: { clusterId: nearest.id },
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
      seconds: TEST_NOTIFICATION_DELAY_S,
      channelId: ANDROID_CHANNEL_ID,
    },
  });
  return {
    ok: true,
    message: `Nearest memory is ~${Math.round(nearestDist)}m away (${nearest.assetIds.length} photo${nearest.assetIds.length === 1 ? '' : 's'}). Background the app now. It arrives in ~${TEST_NOTIFICATION_DELAY_S}s.`,
  };
}

// Dev-only: read out the adaptive radii at the user's current spot — the Near Me
// radius and, for the nearest few clusters, each one's trigger radius plus the
// exact gate that would (or wouldn't) let it notify right now. Mirrors the
// handleClusterEnter pipeline so the otherwise-invisible density adaptation is
// inspectable in the field (e.g. walking an old campus).
export async function inspectRadiiHere(): Promise<{
  ok: boolean;
  message: string;
}> {
  const perm = await Location.getForegroundPermissionsAsync();
  if (perm.status !== 'granted') {
    return { ok: false, message: 'Location permission is needed to read the radii here.' };
  }
  const clusters = getClusters() ?? (await loadClustersFromDisk());
  if (!clusters || clusters.length === 0) {
    return { ok: false, message: 'No located photos yet. Open Near Me once to build the index.' };
  }
  const { placeCooldownMs } = await loadSettingsFromDisk();
  const pos = await Location.getCurrentPositionAsync({
    accuracy: Location.Accuracy.Balanced,
  });
  const { latitude, longitude } = pos.coords;
  const nearMe = Math.round(relevanceRadiusFor(latitude, longitude, clusters, NEARME_OPTS));

  const nearest = clusters
    .map((c) => ({ c, d: distanceMeters(latitude, longitude, c.centerLat, c.centerLng) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, 6);

  const lines: string[] = [];
  for (const { c, d } of nearest) {
    const trig = Math.round(clusterRelevanceRadius(c, clusters, TRIGGER_OPTS));
    let status: string;
    if (!isClusterNotifiable(c)) status = 'too recent (<90d)';
    else if (!isAreaNotifiable(c, clusters)) status = 'recent media nearby';
    else if (d > trig) status = `out of range (${trig}m)`;
    else {
      const cd = clusterRelevanceRadius(c, clusters, COOLDOWN_OPTS);
      if (await isRoutineLocation(c.centerLat, c.centerLng)) {
        status = `home/work (${await routineDayCount(c.centerLat, c.centerLng)} days)`;
      } else if (await isClusterInCooldown(c.id, undefined, placeCooldownMs)) {
        status = 'spent (cooldown)';
      } else if (await isInCooldown(c.centerLat, c.centerLng, undefined, cd)) {
        status = `cooldown (${Math.round(cd)}m)`;
      } else {
        status = `WOULD FIRE (≤${trig}m)`;
      }
    }
    lines.push(`• ${Math.round(d)}m · ${c.assetIds.length}📷 · ${status}`);
  }

  return {
    ok: true,
    message:
      `Near Me radius: ${nearMe}m\n${clusters.length} places total\n\n` +
      `Nearest places:\n${lines.join('\n')}`,
  };
}

// Dev-only: fire the in-app foreground banner immediately, bypassing every gate
// (area/routine/cooldown) so it can be previewed at home — where a real enter is
// suppressed because home has recent photos and is a routine place. Mirrors the
// foreground branch of handleClusterEnter exactly: the same nearby count (from
// the shared index at your current spot, NEARME_OPTS radius) and the same
// 'nearby' banner that taps to the refreshed Near Me grid (no cluster view).
export async function previewForegroundBanner(): Promise<{
  ok: boolean;
  message: string;
}> {
  const perm = await Location.getForegroundPermissionsAsync();
  if (perm.status !== 'granted') {
    return { ok: false, message: 'Location permission is needed to preview the banner here.' };
  }
  const index = getIndex();
  if (!index) {
    return { ok: false, message: 'No located photos yet. Open Near Me once to build the index.' };
  }
  const clusters = getClusters() ?? (await loadClustersFromDisk()) ?? [];
  const pos =
    (await Location.getLastKnownPositionAsync()) ??
    (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }));
  const { latitude, longitude } = pos.coords;
  const radiusM = relevanceRadiusFor(latitude, longitude, clusters, NEARME_OPTS);
  const count = nearbyCount(index, { latitude, longitude }, radiusM);
  showBanner({ kind: 'nearby', count });
  return {
    ok: true,
    message: `Banner fired: ${count} ${count === 1 ? 'memory' : 'memories'} near you. Tap it to refresh Near Me.`,
  };
}

// Adjacent ~50m clusters sit inside each other's 120m regions, so one arrival
// can deliver several Enter events at once. Chain them so the cooldown written
// by the first enter is visible to the rest — run concurrently they all read
// "not in cooldown" and the same place notifies more than once. Re-anchoring
// runs on the same chain so regions aren't replaced mid-enter.
let workChain: Promise<void> = Promise.resolve();

async function enqueue(work: () => Promise<void>, label: string): Promise<void> {
  workChain = workChain.catch(() => {}).then(work);
  try {
    await workChain;
  } catch (e) {
    console.warn(label, e);
  }
}

// Headless path for a boundary exit: the user left the area the registered
// regions cover, so re-pick the nearest clusters around wherever they are now.
// Reads everything from disk — the task may run with the app killed.
async function reanchorFromBackground(): Promise<void> {
  const settings = await loadSettingsFromDisk();
  if (!settings.enabled) return;
  const clusters = await loadClustersFromDisk();
  if (!clusters || clusters.length === 0) return;
  // An exit just fired, so the OS has a fresh fix; fall back to requesting one.
  const pos =
    (await Location.getLastKnownPositionAsync()) ??
    (await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    }));
  await registerGeofencesAt(pos.coords.latitude, pos.coords.longitude, clusters);
}

TaskManager.defineTask(GEOFENCE_TASK_NAME, async ({ data, error }) => {
  if (error) {
    console.warn('Geofence task error', error);
    return;
  }
  const event = data as {
    eventType: Location.GeofencingEventType;
    region: Location.LocationRegion;
  };
  const id = event.region?.identifier;
  if (!id) return;
  if (id === BOUNDARY_REGION_ID) {
    if (event.eventType !== Location.GeofencingEventType.Exit) return;
    await enqueue(reanchorFromBackground, 'Geofence re-anchor failed');
    return;
  }
  if (event.eventType !== Location.GeofencingEventType.Enter) return;
  await enqueue(() => handleClusterEnter(id), 'Geofence enter handling failed');
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
  const clusters = await ensureClusters(assets);
  await registerGeofencesAt(lat, lng, clusters);
}

async function registerGeofencesAt(
  lat: number,
  lng: number,
  clusters: PhotoCluster[]
): Promise<void> {
  // Ask for one more than fits so we know whether any cluster is left out.
  const nearest = nearestNotifiableClusters(clusters, lat, lng, MAX_REGIONS + 1);
  if (nearest.length === 0) {
    await stopGeofencingIfActive();
    return;
  }
  const overflow = nearest.length > MAX_REGIONS;
  const selected = overflow ? nearest.slice(0, MAX_REGIONS - 1) : nearest;
  const regions: Location.LocationRegion[] = selected.map((c) => ({
    identifier: c.id,
    latitude: c.centerLat,
    longitude: c.centerLng,
    // Adapts to local cluster spacing: dense areas clamp to the ~120m floor
    // (unchanged), sparse areas widen so a far-flung memory still triggers.
    radius: clusterRelevanceRadius(c, clusters, TRIGGER_OPTS),
    notifyOnEnter: true,
    notifyOnExit: false,
  }));
  if (overflow) {
    // Spend the last slot on the re-anchor boundary, sized so its exit fires
    // before the user could reach the nearest cluster we had to leave out.
    const firstUncovered = nearest[MAX_REGIONS - 1];
    const radius = Math.min(
      BOUNDARY_MAX_RADIUS_METERS,
      Math.max(
        BOUNDARY_MIN_RADIUS_METERS,
        // Subtract the uncovered cluster's OWN (possibly widened) trigger radius
        // so the boundary's exit still fires before its enter region would.
        distanceMeters(lat, lng, firstUncovered.centerLat, firstUncovered.centerLng) -
          clusterRelevanceRadius(firstUncovered, clusters, TRIGGER_OPTS)
      )
    );
    regions.push({
      identifier: BOUNDARY_REGION_ID,
      latitude: lat,
      longitude: lng,
      radius,
      notifyOnEnter: false,
      notifyOnExit: true,
    });
  }
  await Location.startGeofencingAsync(GEOFENCE_TASK_NAME, regions);
  lastEvaluatedLat = lat;
  lastEvaluatedLng = lng;
  lastEvaluatedAt = Date.now();
}

// Foreground fallback: with only When-In-Use location, startGeofencingAsync
// throws on both platforms, so geofencing can't run at all. While the app is
// open we watch position instead and push any hit through the same enter
// pipeline (area rules, cooldown, engagement -> in-app banner). The generation
// counter closes the gap where stop() lands while watchPositionAsync is still
// resolving.
let fallbackGen = 0;
let fallbackSub: Location.LocationSubscription | null = null;

export async function startForegroundFallback(): Promise<void> {
  if (fallbackSub) return;
  const gen = ++fallbackGen;
  const sub = await Location.watchPositionAsync(
    {
      accuracy: Location.Accuracy.Balanced,
      distanceInterval: FALLBACK_DISTANCE_INTERVAL_M,
    },
    (pos) => {
      void checkFallbackPosition(pos.coords.latitude, pos.coords.longitude);
    }
  );
  if (gen !== fallbackGen || fallbackSub) {
    sub.remove();
    return;
  }
  fallbackSub = sub;
}

export function stopForegroundFallback(): void {
  fallbackGen++;
  fallbackSub?.remove();
  fallbackSub = null;
}

async function checkFallbackPosition(lat: number, lng: number): Promise<void> {
  // findClusterWithinRadius reads the in-memory index; hydrate it first (a
  // no-op once cached).
  const clusters = getClusters() ?? (await loadClustersFromDisk());
  if (!clusters) return;
  // Match the background enter path: the search radius adapts to local density.
  const radius = relevanceRadiusFor(lat, lng, clusters, TRIGGER_OPTS);
  const cluster = findClusterWithinRadius(lat, lng, radius);
  if (!cluster) return;
  await enqueue(
    () => handleClusterEnter(cluster.id),
    'Foreground memory check failed'
  );
}

export async function stopGeofencingIfActive(): Promise<void> {
  // Forget the rotation anchor: with regions unregistered, "you haven't moved
  // since the last evaluation" must not skip re-registration — otherwise
  // toggling the feature off and back on leaves no geofences monitored until
  // the user moves 500m or 6h pass.
  resetEvaluation();
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
