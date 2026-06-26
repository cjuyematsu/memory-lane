/**
 * Radii analyzer — not a pass/fail unit test so much as an inspectable readout
 * of the density-adaptive radii (it does assert invariants too). It imports the
 * REAL clustering + metric so it never drifts from production, prints tables for
 * a few synthetic geographies, encodes the "old campus" goal (dorm fires, then
 * the gym only as you approach it) as an assertion, and — when you point it at a
 * real index — prints the radius distribution for YOUR library:
 *
 *   1) xcrun simctl get_app_container booted <your.bundle.id> data
 *   2) ANALYZE_INDEX="<that>/Documents/located-assets.json" npx jest radii-analysis
 *
 * Run synthetic only:  npx jest radii-analysis
 */
import type { AssetIndex, LocatedAsset } from '@/hooks/use-located-assets';
import {
  distanceMeters,
  getClusters,
  isAreaNotifiable,
  isClusterNotifiable,
  type PhotoCluster,
} from '@/hooks/use-photo-clusters';
import {
  clusterRelevanceRadius,
  NEARME_OPTS,
  relevanceRadiusFor,
  TRIGGER_OPTS,
} from '@/lib/relevance-radius';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs = require('fs') as { readFileSync: (p: string, enc: string) => string };

let mockIndex: AssetIndex | null = null;
jest.mock('@/hooks/use-located-assets', () => ({
  ensureIndex: jest.fn(async () => mockIndex),
  getIndex: jest.fn(() => mockIndex),
  invalidateIndex: jest.fn(),
  loadIndexFromDisk: jest.fn(async () => mockIndex),
}));

const BASE_LAT = 34.0;
const BASE_LNG = -117.0;
const M_PER_DEG_LAT = 111195;
const M_PER_DEG_LNG = 111195 * Math.cos((BASE_LAT * Math.PI) / 180);
const DAY = 24 * 60 * 60 * 1000;
const OLD = Date.now() - 400 * DAY; // old enough to be notifiable

// A place at (north, east) meters from the base point — one photo per place,
// so cluster.assetIds[0] doubles as a human label.
function place(id: string, north: number, east: number, creationTime = OLD): LocatedAsset {
  return {
    id,
    lat: BASE_LAT + north / M_PER_DEG_LAT,
    lng: BASE_LNG + east / M_PER_DEG_LNG,
    creationTime,
    mediaType: 'photo' as never,
  };
}

function setIndex(located: LocatedAsset[]) {
  mockIndex = { located, unlocatedVideos: [], processedIds: located.map((a) => a.id) };
}

const label = (c: PhotoCluster) => String(c.assetIds[0]);
const trigger = (c: PhotoCluster, all: PhotoCluster[]) =>
  Math.round(clusterRelevanceRadius(c, all, TRIGGER_OPTS));

function nearestNeighborM(c: PhotoCluster, all: PhotoCluster[]): number {
  let best = Infinity;
  for (const o of all) {
    if (o.id === c.id) continue;
    best = Math.min(best, distanceMeters(c.centerLat, c.centerLng, o.centerLat, o.centerLng));
  }
  return best;
}

beforeEach(() => {
  mockIndex = null;
});

describe('radii analysis', () => {
  // A small dense campus: dorm, dining, union, library, gym, science, arts —
  // buildings 120–320m apart.
  const CAMPUS: LocatedAsset[] = [
    place('dorm', 0, 0),
    place('dining', 0, 120),
    place('union', 130, 130),
    place('library', 250, 50),
    place('gym', 320, 0),
    place('science', 250, -180),
    place('arts', 400, 200),
  ];

  it('campus (dense): each building gets a tight, separate trigger radius', () => {
    setIndex(CAMPUS);
    const clusters = getClusters()!;
    console.log('\n=== CAMPUS (dense) ===');
    console.log(
      `Near Me radius at the dorm: ${Math.round(
        relevanceRadiusFor(BASE_LAT, BASE_LNG, clusters, NEARME_OPTS)
      )}m`
    );
    for (const c of clusters) {
      console.log(
        `${label(c).padEnd(8)} nearest-neighbor ${String(
          Math.round(nearestNeighborM(c, clusters))
        ).padStart(4)}m → trigger ${trigger(c, clusters)}m`
      );
    }
    // Dense: detected as dense, so triggers stay tight (well below the ceiling)
    // — that's what lets each building notify separately as you walk to it.
    for (const c of clusters) {
      const r = clusterRelevanceRadius(c, clusters, TRIGGER_OPTS);
      expect(r).toBeGreaterThanOrEqual(TRIGGER_OPTS.floor);
      expect(r).toBeLessThan(200);
    }
  });

  it('campus walk: the dorm fires near the dorm, the gym only as you approach it', () => {
    setIndex(CAMPUS);
    const clusters = getClusters()!;

    const inRangeAt = (north: number): string[] => {
      const lat = BASE_LAT + north / M_PER_DEG_LAT;
      return clusters
        .filter((c) => {
          const d = distanceMeters(lat, BASE_LNG, c.centerLat, c.centerLng);
          return d <= clusterRelevanceRadius(c, clusters, TRIGGER_OPTS);
        })
        .map(label);
    };

    console.log('\n=== CAMPUS WALK (dorm → gym, walking north) ===');
    console.log('(in-range = would notify, modulo the 6h cooldown / engagement gates)');
    for (let north = 0; north <= 320; north += 40) {
      console.log(`${String(north).padStart(3)}m: ${inRangeAt(north).join(', ') || '—'}`);
    }

    // The user's goal, as an assertion: at the dorm you get the dorm (not the
    // gym); you don't pick up the gym until you've walked over to it.
    const atDorm = inRangeAt(0);
    expect(atDorm).toContain('dorm');
    expect(atDorm).not.toContain('gym');
    const atGym = inRangeAt(320);
    expect(atGym).toContain('gym');
    expect(atGym).not.toContain('dorm');
  });

  it('vacation (sparse): isolated spots widen toward the ceiling', () => {
    setIndex([place('beach', 0, 0), place('pier', 0, 1500), place('lookout', 2000, 800)]);
    const clusters = getClusters()!;
    console.log('\n=== VACATION (sparse) ===');
    for (const c of clusters) {
      console.log(`${label(c).padEnd(8)} → trigger ${trigger(c, clusters)}m`);
    }
    for (const c of clusters) {
      expect(clusterRelevanceRadius(c, clusters, TRIGGER_OPTS)).toBe(TRIGGER_OPTS.ceiling);
    }
  });

  it('suburban (medium): spacing lands the radius between floor and ceiling', () => {
    setIndex([
      place('home', 0, 0),
      place('park', 0, 400),
      place('cafe', 400, 0),
      place('school', 400, 400),
    ]);
    const clusters = getClusters()!;
    console.log('\n=== SUBURBAN (medium) ===');
    for (const c of clusters) {
      const r = trigger(c, clusters);
      console.log(`${label(c).padEnd(8)} → trigger ${r}m`);
      expect(r).toBeGreaterThan(TRIGGER_OPTS.floor);
      expect(r).toBeLessThan(TRIGGER_OPTS.ceiling);
    }
  });

  it('real library: set ANALYZE_INDEX to your located-assets.json to analyze', () => {
    const path = process.env.ANALYZE_INDEX;
    if (!path) {
      console.log(
        '\n[real-library] skipped. To analyze YOUR library:\n' +
          '  1) xcrun simctl get_app_container booted <your.bundle.id> data\n' +
          '  2) ANALYZE_INDEX="<that>/Documents/located-assets.json" npx jest radii-analysis\n'
      );
      return;
    }
    const raw = JSON.parse(fs.readFileSync(path, 'utf8')) as AssetIndex;
    setIndex(raw.located);
    const clusters = getClusters()!;
    const trigs = clusters.map((c) => clusterRelevanceRadius(c, clusters, TRIGGER_OPTS));

    const buckets = { floor: 0, low: 0, mid: 0, ceiling: 0 };
    for (const t of trigs) {
      if (t <= TRIGGER_OPTS.floor) buckets.floor++;
      else if (t < 180) buckets.low++;
      else if (t < TRIGGER_OPTS.ceiling) buckets.mid++;
      else buckets.ceiling++;
    }
    const sorted = [...trigs].sort((a, b) => a - b);
    const median = sorted.length ? Math.round(sorted[Math.floor(sorted.length / 2)]) : 0;
    const pct = (n: number) => (trigs.length ? `${Math.round((100 * n) / trigs.length)}%` : '0%');

    console.log('\n=== REAL LIBRARY ===');
    console.log(`assets: ${raw.located.length}   clusters (places): ${clusters.length}`);
    console.log(
      `notifiable (older than 90d): ${clusters.filter((c) => isClusterNotifiable(c)).length}` +
        `   after the neighborhood gate: ${clusters.filter((c) => isAreaNotifiable(c, clusters)).length}`
    );
    console.log(`trigger radius — median ${median}m`);
    console.log(`  floor (=120m)   ${String(buckets.floor).padStart(4)}  ${pct(buckets.floor)}`);
    console.log(`  120–180m        ${String(buckets.low).padStart(4)}  ${pct(buckets.low)}`);
    console.log(`  180–<250m       ${String(buckets.mid).padStart(4)}  ${pct(buckets.mid)}`);
    console.log(`  ceiling (=250m) ${String(buckets.ceiling).padStart(4)}  ${pct(buckets.ceiling)}`);

    for (const t of trigs) {
      expect(t).toBeGreaterThanOrEqual(TRIGGER_OPTS.floor);
      expect(t).toBeLessThanOrEqual(TRIGGER_OPTS.ceiling);
    }
  });
});
