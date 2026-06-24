import type { AssetIndex, LocatedAsset } from '@/hooks/use-located-assets';
import {
  distanceMeters,
  findClusterWithinRadius,
  getClusters,
  isAreaNotifiable,
  isClusterNotifiable,
  nearestNotifiableClusters,
  type PhotoCluster,
} from '@/hooks/use-photo-clusters';

let mockIndex: AssetIndex | null = null;

jest.mock('@/hooks/use-located-assets', () => ({
  ensureIndex: jest.fn(async () => mockIndex),
  getIndex: jest.fn(() => mockIndex),
  invalidateIndex: jest.fn(),
  loadIndexFromDisk: jest.fn(async () => mockIndex),
}));

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_800_000_000_000;
const OLD = NOW - 400 * DAY;
const RECENT = NOW - 5 * DAY;

function located(
  id: string,
  lat: number,
  lng: number,
  creationTime: number | null
): LocatedAsset {
  return { id, lat, lng, creationTime, mediaType: 'photo' as never };
}

function setIndex(assets: LocatedAsset[]) {
  mockIndex = { located: assets, unlocatedVideos: [], processedIds: [] };
}

function cluster(over: Partial<PhotoCluster> = {}): PhotoCluster {
  return {
    id: 'c',
    centerLat: 34,
    centerLng: -117,
    assetIds: ['a'],
    oldestCreationTime: OLD,
    newestCreationTime: OLD,
    ...over,
  };
}

beforeEach(() => {
  mockIndex = null;
});

describe('clustering', () => {
  it('groups assets in the same ~50m cell and splits separate cells', () => {
    setIndex([
      located('a', 34.0, -117.0, OLD),
      located('b', 34.00002, -117.0, OLD - DAY),
      located('c', 34.0005, -117.0, OLD), // next grid cell, ~55m north
    ]);
    const clusters = getClusters()!;
    expect(clusters).toHaveLength(2);
    const ab = clusters.find((c) => c.assetIds.includes('a'))!;
    expect(ab.assetIds.sort()).toEqual(['a', 'b']);
    expect(ab.centerLat).toBeCloseTo(34.00001, 8);
    expect(ab.centerLng).toBeCloseTo(-117.0, 8);
    expect(ab.oldestCreationTime).toBe(OLD - DAY);
    expect(ab.newestCreationTime).toBe(OLD);
  });

  it('derives stable ids from the grid cell', () => {
    setIndex([located('a', 34.0, -117.0, OLD)]);
    const first = getClusters()![0].id;
    setIndex([located('zzz', 34.0001, -117.0001, RECENT)]); // same cell
    const second = getClusters()![0].id;
    expect(second).toBe(first);
  });

  it('handles assets with no creation time', () => {
    setIndex([located('a', 34.0, -117.0, null)]);
    const c = getClusters()![0];
    expect(c.oldestCreationTime).toBeNull();
    expect(c.newestCreationTime).toBeNull();
  });
});

describe('isClusterNotifiable', () => {
  it('requires the newest photo to be older than 90 days', () => {
    expect(
      isClusterNotifiable(cluster({ newestCreationTime: NOW - 91 * DAY }), NOW)
    ).toBe(true);
    expect(
      isClusterNotifiable(cluster({ newestCreationTime: NOW - 89 * DAY }), NOW)
    ).toBe(false);
  });

  it('is false without timestamps', () => {
    expect(isClusterNotifiable(cluster({ newestCreationTime: null }), NOW)).toBe(
      false
    );
  });
});

describe('isAreaNotifiable', () => {
  // ~0.0009° latitude ≈ 100m
  const DEG_100M = 0.0009;

  it('suppresses an old cluster when recent media sits within 150m', () => {
    const oldHome = cluster({ id: 'old', centerLat: 34.0 });
    const recentNeighbor = cluster({
      id: 'recent',
      centerLat: 34.0 + DEG_100M,
      newestCreationTime: RECENT,
    });
    expect(isAreaNotifiable(oldHome, [oldHome, recentNeighbor], NOW)).toBe(false);
  });

  it('does not suppress when recent media is beyond 150m (dense area)', () => {
    // Only two clusters ~300m apart, so the neighborhood stays at the 150m
    // floor and the recent photo is out of range — still notifiable.
    const oldSpot = cluster({ id: 'old', centerLat: 34.0 });
    const farRecent = cluster({
      id: 'recent',
      centerLat: 34.0 + 3 * DEG_100M, // ~300m
      newestCreationTime: RECENT,
    });
    expect(isAreaNotifiable(oldSpot, [oldSpot, farRecent], NOW)).toBe(true);
  });

  it('widens the suppression neighborhood in a sparse area', () => {
    // The nearest OTHER places are ~800m+ away (genuinely spread out), so the
    // neighborhood widens to the ceiling and a recent photo ~250m away now
    // suppresses the old spot — it would not under a fixed 150m radius.
    const oldSpot = cluster({ id: 'old', centerLat: 34.0 });
    const recent = cluster({
      id: 'recent',
      centerLat: 34.0 + 2.5 * DEG_100M, // ~250m
      newestCreationTime: RECENT,
    });
    const far1 = cluster({ id: 'far1', centerLat: 34.0 + 8 * DEG_100M }); // ~800m, old
    const far2 = cluster({ id: 'far2', centerLat: 34.0 + 9 * DEG_100M }); // ~900m, old
    expect(isAreaNotifiable(oldSpot, [oldSpot, recent, far1, far2], NOW)).toBe(false);
  });
});

describe('nearestNotifiableClusters', () => {
  it('filters to notifiable clusters, sorts by distance, and limits to n', () => {
    setIndex([
      located('near', 34.001, -117.0, OLD), // ~111m away
      located('far', 34.01, -117.0, OLD), // ~1.1km away
      located('recent', 34.02, -117.0, RECENT), // not notifiable
    ]);
    const clusters = getClusters()!;
    const all = nearestNotifiableClusters(clusters, 34.0, -117.0, 10, NOW);
    expect(all.map((c) => c.assetIds[0])).toEqual(['near', 'far']);
    const limited = nearestNotifiableClusters(clusters, 34.0, -117.0, 1, NOW);
    expect(limited.map((c) => c.assetIds[0])).toEqual(['near']);
  });

  it('returns empty for an empty cluster list', () => {
    expect(nearestNotifiableClusters([], 34, -117, 5, NOW)).toEqual([]);
  });
});

describe('findClusterWithinRadius', () => {
  it('returns the nearest notifiable cluster inside the radius', () => {
    setIndex([
      located('near', 34.0005, -117.0, OLD), // ~55m
      located('far', 34.002, -117.0, OLD), // ~220m
    ]);
    const hit = findClusterWithinRadius(34.0, -117.0, 120, NOW);
    expect(hit?.assetIds).toEqual(['near']);
  });

  it('returns null when nothing notifiable is inside the radius', () => {
    setIndex([located('recent', 34.0005, -117.0, RECENT)]);
    expect(findClusterWithinRadius(34.0, -117.0, 120, NOW)).toBeNull();
  });
});

describe('distanceMeters', () => {
  it('matches known distances', () => {
    expect(distanceMeters(34, -117, 34, -117)).toBe(0);
    // One degree of latitude ≈ 111.2km
    expect(distanceMeters(34, -117, 35, -117)).toBeGreaterThan(110_000);
    expect(distanceMeters(34, -117, 35, -117)).toBeLessThan(112_500);
    // 0.0005° latitude ≈ 55.6m (the cluster cell size)
    const cell = distanceMeters(34, -117, 34.0005, -117);
    expect(cell).toBeGreaterThan(54);
    expect(cell).toBeLessThan(57);
  });
});
