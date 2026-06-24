import { Asset } from 'expo-media-library';

import {
  ensureIndex,
  getIndex,
  invalidateIndex,
  loadIndexFromDisk,
  type AssetIndex,
  type LocatedAsset,
} from '@/hooks/use-located-assets';
import { relevanceRadiusFor, SUPPRESS_OPTS } from '@/lib/relevance-radius';

// ~50m grid quantization. 1° latitude ≈ 111km, so 0.0005° ≈ 55m.
const CELL_SIZE_DEG = 0.0005;
// A place is worth resurfacing only if you haven't been there in a while — its
// most RECENT photo is older than this. That's what actually excludes places
// you currently frequent (home, work) and anywhere visited lately; the whole
// point is returning somewhere after a long absence. (A newest photo this old
// also guarantees the memory itself is old.) Tune here.
const RECENT_VISIT_MS = 90 * 24 * 60 * 60 * 1000; // ~3 months

export type PhotoCluster = {
  // Stable identifier derived from the grid cell — survives across sessions
  // so we can correlate cooldown timestamps and engagement records by id.
  id: string;
  centerLat: number;
  centerLng: number;
  assetIds: string[];
  oldestCreationTime: number | null;
  newestCreationTime: number | null;
};

// Clusters are a pure derivation of the shared index. Cache is keyed on the
// index object reference so it auto-recomputes whenever the index rebuilds —
// no matter which code path triggered the rebuild.
let cached: PhotoCluster[] | null = null;
let cachedFrom: AssetIndex | null = null;

function clustersForIndex(index: AssetIndex): PhotoCluster[] {
  if (cached && cachedFrom === index) return cached;
  cached = clusterFrom(index.located);
  cachedFrom = index;
  return cached;
}

function cellKey(lat: number, lng: number): string {
  const cx = Math.round(lat / CELL_SIZE_DEG);
  const cy = Math.round(lng / CELL_SIZE_DEG);
  return `${cx},${cy}`;
}

// Pure, synchronous derivation: group located assets into ~50m cells. Cheap
// enough to run on demand (no metadata loading — that already happened when
// the shared index was built).
function clusterFrom(located: LocatedAsset[]): PhotoCluster[] {
  const cells = new Map<string, LocatedAsset[]>();
  for (const a of located) {
    const k = cellKey(a.lat, a.lng);
    let list = cells.get(k);
    if (!list) {
      list = [];
      cells.set(k, list);
    }
    list.push(a);
  }

  const clusters: PhotoCluster[] = [];
  for (const [id, members] of cells) {
    let sumLat = 0;
    let sumLng = 0;
    let oldest = Infinity;
    let newest = -Infinity;
    for (const m of members) {
      sumLat += m.lat;
      sumLng += m.lng;
      if (m.creationTime != null) {
        if (m.creationTime < oldest) oldest = m.creationTime;
        if (m.creationTime > newest) newest = m.creationTime;
      }
    }
    clusters.push({
      id,
      centerLat: sumLat / members.length,
      centerLng: sumLng / members.length,
      assetIds: members.map((m) => m.id),
      oldestCreationTime: isFinite(oldest) ? oldest : null,
      newestCreationTime: isFinite(newest) ? newest : null,
    });
  }
  return clusters;
}

export async function ensureClusters(assets: Asset[]): Promise<PhotoCluster[]> {
  const index = await ensureIndex(assets);
  return clustersForIndex(index);
}

export function getClusters(): PhotoCluster[] | null {
  const index = getIndex();
  return index ? clustersForIndex(index) : null;
}

// The background geofence task may run headless (app killed) with an empty
// module cache — read the shared index from disk and derive clusters from it.
export async function loadClustersFromDisk(): Promise<PhotoCluster[] | null> {
  const index = await loadIndexFromDisk();
  return index ? clustersForIndex(index) : null;
}

export function invalidateClusters(): void {
  cached = null;
  cachedFrom = null;
  invalidateIndex();
}

export function isClusterNotifiable(
  cluster: PhotoCluster,
  now: number = Date.now()
): boolean {
  // Keyed on the NEWEST photo: notify only for places you haven't photographed
  // in RECENT_VISIT_MS, so somewhere you still frequent (home) never qualifies.
  if (cluster.newestCreationTime == null) return false;
  return now - cluster.newestCreationTime > RECENT_VISIT_MS;
}

export function distanceMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// True if any cluster within the local relevance radius of this point holds a
// photo/video from inside the recency window — i.e. you've been here lately.
// The radius adapts to local density (SUPPRESS_OPTS) so it widens in step with
// the geofence trigger: in a sparse area a recent photo a few hundred meters
// away still suppresses an old neighbor, keeping home/work from notifying.
function hasRecentMediaNearby(
  clusters: PhotoCluster[],
  lat: number,
  lng: number,
  now: number,
  excludeId?: string
): boolean {
  // The point is a cluster center, so exclude that cluster from the spacing
  // measurement — otherwise it sits at distance 0 and consumes a neighbor slot.
  const radius = relevanceRadiusFor(lat, lng, clusters, SUPPRESS_OPTS, excludeId);
  return clusters.some(
    (c) =>
      c.newestCreationTime != null &&
      now - c.newestCreationTime <= RECENT_VISIT_MS &&
      distanceMeters(lat, lng, c.centerLat, c.centerLng) <= radius
  );
}

// Area-aware notifiability: the cluster's own newest media must be old AND you
// must not have shot anything recently anywhere nearby. The neighborhood check
// is what keeps home from notifying when its recent photos sit in an adjacent
// grid cell. Pass the full cluster list so the radius scan can see neighbors.
export function isAreaNotifiable(
  cluster: PhotoCluster,
  clusters: PhotoCluster[],
  now: number = Date.now()
): boolean {
  if (!isClusterNotifiable(cluster, now)) return false;
  return !hasRecentMediaNearby(
    clusters,
    cluster.centerLat,
    cluster.centerLng,
    now,
    cluster.id
  );
}

// Takes the cluster list explicitly (rather than reading the in-memory index)
// so the headless geofence re-anchor can pass clusters loaded from disk.
export function nearestNotifiableClusters(
  clusters: PhotoCluster[],
  lat: number,
  lng: number,
  n: number,
  now: number = Date.now()
): PhotoCluster[] {
  const eligible = clusters.filter((c) => isAreaNotifiable(c, clusters, now));
  eligible.sort(
    (a, b) =>
      distanceMeters(lat, lng, a.centerLat, a.centerLng) -
      distanceMeters(lat, lng, b.centerLat, b.centerLng)
  );
  return eligible.slice(0, n);
}

export function findClusterWithinRadius(
  lat: number,
  lng: number,
  radiusMeters: number,
  now: number = Date.now()
): PhotoCluster | null {
  const clusters = getClusters();
  if (!clusters) return null;
  let best: PhotoCluster | null = null;
  let bestDist = radiusMeters;
  for (const c of clusters) {
    if (!isAreaNotifiable(c, clusters, now)) continue;
    const d = distanceMeters(lat, lng, c.centerLat, c.centerLng);
    if (d <= bestDist) {
      best = c;
      bestDist = d;
    }
  }
  return best;
}
