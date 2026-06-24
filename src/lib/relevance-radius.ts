import type { PhotoCluster } from '@/hooks/use-photo-clusters';
import { distanceMeters } from '@/utils/distance';

// How "relevant" a memory is to where you're standing is a distance, and that
// distance shouldn't be fixed: in a dense city your photo places sit ~50m apart
// so a tight radius is right; at a spread-out beach the nearest other place is a
// kilometer away, so a memory 300m down the sand is still "here". We measure
// local density purely from the spacing of your OWN photo clusters — no network,
// so this also runs inside the killed-app headless geofence task.
export type RelevanceRadiusOptions = {
  // Smallest meaningful radius. For OS geofences this is the ~100m region-
  // monitoring accuracy floor; for in-app checks it's a UX floor.
  floor: number;
  // Largest radius we'll ever widen to in a sparse area.
  ceiling: number;
  // Which nearest neighbor defines local spacing (see relevanceRadiusFor).
  k: number;
  // Fraction of that neighbor spacing that still counts as "here".
  multiplier: number;
};

// Geofence trigger + foreground fallback. iOS region monitoring is only ~100m
// accurate, so 120m is a hard floor — these effectively only WIDEN in sparse
// areas. Dense areas (clusters ~55m apart) clamp to 120 = today's behavior.
export const TRIGGER_OPTS: RelevanceRadiusOptions = {
  floor: 120,
  ceiling: 400,
  k: 2,
  multiplier: 0.5,
};

// Home/work suppression neighborhood + notification quiet-zone cooldown. floor
// 150 matches today's RECENT_AREA_RADIUS_M / cooldown radius, and is kept
// symmetric with the trigger so a widened sparse-area trigger can't outrun its
// own "have I been here recently" suppression and start firing at home.
export const SUPPRESS_OPTS: RelevanceRadiusOptions = {
  floor: 150,
  ceiling: 400,
  k: 2,
  multiplier: 0.5,
};

// Near Me grid. This is an in-app GPS comparison (not OS-region-limited), so it
// may tighten below 120 in ultra-dense areas; the ceiling is tighter than the
// trigger's because Near Me means "where I'm standing", not "this neighborhood".
export const NEARME_OPTS: RelevanceRadiusOptions = {
  floor: 80,
  ceiling: 300,
  k: 2,
  multiplier: 0.5,
};

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}

// Local photo density expressed as a radius: the distance to the k-th nearest
// OTHER cluster, scaled by `multiplier` and clamped to [floor, ceiling]. Where
// your clusters pack close (city) spacing is small and the result clamps to the
// floor; where they're far apart (beach) it widens toward the ceiling.
//
// Why the k-th neighbor and not the 1st: a single photo that spilled into an
// adjacent ~50m grid cell would read as "dense" (nearest neighbor ~55m) even in
// an otherwise empty area, collapsing the radius to the floor. k=2 smooths over
// one stray cell whenever there's enough data. With fewer than k neighbors (a
// tiny library) there's no stray-vs-bulk to smooth, so we fall back to the
// farthest neighbor we do have; with zero neighbors (a lone memory in an empty
// map) it's maximally sparse → the ceiling (widest, but still bounded).
//
// Pure and O(n): one pass tracking the k smallest distances (k is tiny, so a
// small ascending array beats a full sort or a heap). `excludeId` skips the
// query cluster itself when the point is a cluster center.
export function relevanceRadiusFor(
  lat: number,
  lng: number,
  clusters: PhotoCluster[],
  opts: RelevanceRadiusOptions,
  excludeId?: string
): number {
  const { floor, ceiling, k, multiplier } = opts;
  const here = { latitude: lat, longitude: lng };
  const smallest: number[] = []; // ascending, length <= k
  for (const c of clusters) {
    if (c.id === excludeId) continue;
    const d = distanceMeters(here, { latitude: c.centerLat, longitude: c.centerLng });
    if (smallest.length === k && d >= smallest[k - 1]) continue;
    let i = Math.min(smallest.length, k - 1);
    while (i > 0 && smallest[i - 1] > d) i--;
    smallest.splice(i, 0, d);
    if (smallest.length > k) smallest.length = k;
  }
  if (smallest.length === 0) return ceiling;
  // The k-th nearest, or the farthest available when fewer than k neighbors exist.
  const spacing = smallest[Math.min(k, smallest.length) - 1];
  return clamp(multiplier * spacing, floor, ceiling);
}

// Convenience for the geofence registration / enter path: the relevance radius
// of a specific cluster, excluding itself from the spacing measurement.
export function clusterRelevanceRadius(
  cluster: PhotoCluster,
  clusters: PhotoCluster[],
  opts: RelevanceRadiusOptions
): number {
  return relevanceRadiusFor(
    cluster.centerLat,
    cluster.centerLng,
    clusters,
    opts,
    cluster.id
  );
}
