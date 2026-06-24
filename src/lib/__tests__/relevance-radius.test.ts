import type { PhotoCluster } from '@/hooks/use-photo-clusters';
import {
  clusterRelevanceRadius,
  NEARME_OPTS,
  relevanceRadiusFor,
  SUPPRESS_OPTS,
  TRIGGER_OPTS,
} from '@/lib/relevance-radius';

// 1° latitude ≈ 111.2km, so a north offset of `meters / 111195` degrees lands
// ~`meters` from the origin. Lets fixtures be expressed in meters.
const ORIGIN = { lat: 34, lng: -117 };
const at = (meters: number) => 34 + meters / 111195;

function cl(id: string, lat: number): PhotoCluster {
  return {
    id,
    centerLat: lat,
    centerLng: -117,
    assetIds: [],
    oldestCreationTime: null,
    newestCreationTime: null,
  };
}

const radiusAt = (
  clusters: PhotoCluster[],
  opts = TRIGGER_OPTS,
  excludeId?: string
) => relevanceRadiusFor(ORIGIN.lat, ORIGIN.lng, clusters, opts, excludeId);

describe('relevanceRadiusFor', () => {
  it('clamps to the floor where clusters pack close (a dense city)', () => {
    // 2nd-nearest ~110m → 0.5*110=55 → clamps up to the 120m floor.
    expect(radiusAt([cl('a', at(55)), cl('b', at(110))])).toBe(120);
  });

  it('widens to the ceiling where clusters are spread out (a beach)', () => {
    // 2nd-nearest ~1100m → 0.5*1100=550 → clamps down to the 400m ceiling.
    expect(radiusAt([cl('a', at(1000)), cl('b', at(1100))])).toBe(400);
  });

  it('varies between floor and ceiling in the transition zone', () => {
    // 2nd-nearest ~520m → 0.5*520 ≈ 260.
    const r = radiusAt([cl('a', at(500)), cl('b', at(520))]);
    expect(r).toBeGreaterThan(TRIGGER_OPTS.floor);
    expect(r).toBeLessThan(TRIGGER_OPTS.ceiling);
    expect(r).toBeCloseTo(260, 0);
  });

  it('uses the 2nd-nearest neighbor, ignoring a single stray close cell', () => {
    // One stray ~55m cell among otherwise far (~1km) clusters must NOT read as
    // dense — the 2nd-nearest (~1000m) decides, so it widens to the ceiling.
    // (A 1st-nearest rule would collapse to the 120m floor here.)
    expect(
      radiusAt([cl('stray', at(55)), cl('f1', at(1000)), cl('f2', at(1100))])
    ).toBe(400);
  });

  it('returns the ceiling with no neighbors (a lone memory)', () => {
    expect(radiusAt([])).toBe(400);
  });

  it('falls back to the only neighbor when fewer than k exist', () => {
    // A single close neighbor → dense → floor.
    expect(radiusAt([cl('a', at(55))])).toBe(120);
    // A single far neighbor → sparse → ceiling.
    expect(radiusAt([cl('a', at(1000))])).toBe(400);
  });

  it('excludeId skips the cluster itself', () => {
    const self = cl('self', at(0));
    const clusters = [self, cl('a', at(55)), cl('b', at(1100))];
    // Counting self (distance 0) makes the 2nd-nearest the 55m cell → dense → floor.
    expect(radiusAt(clusters)).toBe(120);
    // Excluding self, the 2nd-nearest is the 1100m cell → sparse → ceiling.
    expect(clusterRelevanceRadius(self, clusters, TRIGGER_OPTS)).toBe(400);
  });

  it('can tighten below the geofence floor for Near Me (in-app, not OS-limited)', () => {
    // ~140m spacing → 0.5*140=70 → clamps to the 80m Near Me floor, tighter
    // than the geofence's 120m floor.
    expect(radiusAt([cl('a', at(130)), cl('b', at(140))], NEARME_OPTS)).toBe(80);
  });

  it('does not mutate the input array', () => {
    const clusters = [cl('a', at(55)), cl('b', at(1000))];
    const snapshot = JSON.parse(JSON.stringify(clusters));
    radiusAt(clusters);
    expect(clusters).toEqual(snapshot);
  });

  it('exposes presets with a floor no greater than the ceiling', () => {
    for (const opts of [TRIGGER_OPTS, SUPPRESS_OPTS, NEARME_OPTS]) {
      expect(opts.floor).toBeLessThanOrEqual(opts.ceiling);
      expect(opts.k).toBeGreaterThanOrEqual(1);
    }
  });
});
