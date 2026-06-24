import { MediaType, type Asset } from 'expo-media-library';

import type { AssetIndex } from '@/hooks/use-located-assets';
import {
  computeNearby,
  mergeNearbyByRecency,
  NEAR_ME_RADIUS_METERS,
  sameNearby,
  type NearbyAsset,
} from '@/hooks/use-nearby-assets';

// use-nearby-assets value-imports expo-media-library (for MediaType) and the
// located-assets index module at the top level; the merge helper touches
// neither, so stub them out to keep this a pure-logic test with no
// disk/native access (the real expo-media-library native module can't load
// under jest). Mirrors photo-clusters.test.ts.
jest.mock('expo-media-library', () => ({
  MediaType: { IMAGE: 'photo', VIDEO: 'video', AUDIO: 'audio', UNKNOWN: 'unknown' },
}));
jest.mock('@/hooks/use-located-assets', () => ({
  ensureIndex: jest.fn(),
  getIndex: jest.fn(() => null),
  invalidateIndex: jest.fn(),
}));

function mk(
  id: string,
  creationTime: number | null,
  kind: 'photo' | 'video' = 'photo'
): NearbyAsset {
  return {
    asset: { id } as NearbyAsset['asset'],
    location: { latitude: 0, longitude: 0 },
    distance: 0,
    isEstimated: false,
    // mediaType is irrelevant to the merge; cast a placeholder.
    mediaType: (kind === 'video' ? 1 : 0) as unknown as NearbyAsset['mediaType'],
    creationTime,
  };
}

const ids = (list: NearbyAsset[]) => list.map((n) => n.asset.id);

describe('mergeNearbyByRecency', () => {
  it('returns [] for empty inputs', () => {
    expect(mergeNearbyByRecency([], [])).toEqual([]);
  });

  it('orders newest first, interleaving photos and videos by time', () => {
    const photos = [mk('p-old', 100), mk('p-new', 300)];
    const videos = [mk('v-mid', 200, 'video')];
    expect(ids(mergeNearbyByRecency(photos, videos))).toEqual([
      'p-new',
      'v-mid',
      'p-old',
    ]);
  });

  it('lets a newer video sort ahead of an older photo', () => {
    const photos = [mk('p', 100)];
    const videos = [mk('v', 500, 'video')];
    expect(ids(mergeNearbyByRecency(photos, videos))).toEqual(['v', 'p']);
  });

  it('sinks null creationTime to the bottom', () => {
    const photos = [mk('dated', 100), mk('undated', null)];
    expect(ids(mergeNearbyByRecency(photos, []))).toEqual(['dated', 'undated']);
  });

  it('sinks zero creationTime to the bottom (treated as oldest)', () => {
    const photos = [mk('zero', 0), mk('dated', 50)];
    expect(ids(mergeNearbyByRecency(photos, []))).toEqual(['dated', 'zero']);
  });

  it('treats null and zero creationTime equivalently', () => {
    const photos = [mk('null', null), mk('zero', 0), mk('dated', 10)];
    const out = ids(mergeNearbyByRecency(photos, []));
    expect(out[0]).toBe('dated');
    // The two undated entries keep their relative input order (stable sort).
    expect(out.slice(1)).toEqual(['null', 'zero']);
  });

  it('preserves input order for equal timestamps (stable), photos before videos', () => {
    const photos = [mk('a', 100), mk('b', 100)];
    const videos = [mk('c', 100, 'video')];
    expect(ids(mergeNearbyByRecency(photos, videos))).toEqual(['a', 'b', 'c']);
  });

  it('does not mutate the input arrays', () => {
    const photos = [mk('p1', 100), mk('p2', 300)];
    const videos = [mk('v1', 200, 'video')];
    const photosCopy = ids(photos);
    const videosCopy = ids(videos);
    const out = mergeNearbyByRecency(photos, videos);
    expect(out).not.toBe(photos);
    expect(ids(photos)).toEqual(photosCopy);
    expect(ids(videos)).toEqual(videosCopy);
  });
});

describe('sameNearby', () => {
  const base = (): NearbyAsset => ({
    asset: { id: 'x' } as NearbyAsset['asset'],
    location: { latitude: 1, longitude: 2 },
    distance: 10,
    isEstimated: false,
    mediaType: 0 as unknown as NearbyAsset['mediaType'],
    creationTime: 100,
  });

  it('is true for objects with identical UI fields', () => {
    expect(sameNearby(base(), base())).toBe(true);
  });

  it('compares by asset id', () => {
    expect(
      sameNearby(base(), { ...base(), asset: { id: 'y' } as NearbyAsset['asset'] })
    ).toBe(false);
  });

  it('detects a changed distance (you moved)', () => {
    expect(sameNearby(base(), { ...base(), distance: 11 })).toBe(false);
  });

  it('detects a changed location', () => {
    expect(
      sameNearby(base(), { ...base(), location: { latitude: 1, longitude: 3 } })
    ).toBe(false);
  });

  it('detects a changed creationTime', () => {
    expect(sameNearby(base(), { ...base(), creationTime: 101 })).toBe(false);
  });

  it('treats null vs a real creationTime as different', () => {
    expect(sameNearby(base(), { ...base(), creationTime: null })).toBe(false);
  });

  it('detects a flipped isEstimated flag', () => {
    expect(sameNearby(base(), { ...base(), isEstimated: true })).toBe(false);
  });

  it('detects a changed mediaType', () => {
    expect(
      sameNearby(base(), {
        ...base(),
        mediaType: 1 as unknown as NearbyAsset['mediaType'],
      })
    ).toBe(false);
  });
});

describe('computeNearby radius', () => {
  const origin = { latitude: 40, longitude: -75 };
  // 1 degree of latitude is ~111.2 km, so these north offsets are ~111m,
  // ~445m, and ~1112m from the origin.
  const M111 = 40.001;
  const M445 = 40.004;
  const M1112 = 40.01;

  const located = (
    id: string,
    lat: number,
    kind: 'photo' | 'video',
    creationTime: number | null = 1000
  ) => ({
    id,
    lat,
    lng: -75,
    creationTime,
    mediaType: kind === 'video' ? MediaType.VIDEO : MediaType.IMAGE,
  });

  const indexOf = (entries: ReturnType<typeof located>[]): AssetIndex =>
    ({
      located: entries,
      unlocatedVideos: [],
      processedIds: entries.map((e) => e.id),
    }) as AssetIndex;

  const assetsOf = (ids: string[]) => ids.map((id) => ({ id }) as Asset);

  it('defaults to the 150m fallback radius', () => {
    expect(NEAR_ME_RADIUS_METERS).toBe(150);
  });

  it('honors a wider explicit radius (sparse area)', () => {
    const index = indexOf([located('mid', M445, 'photo')]);
    // ~445m: outside the 150m default, inside an adaptively-widened 500m.
    expect(computeNearby(index, assetsOf(['mid']), origin).photos).toEqual([]);
    expect(
      computeNearby(index, assetsOf(['mid']), origin, 500).photos.map((p) => p.asset.id)
    ).toEqual(['mid']);
  });

  it('honors a tighter explicit radius (dense area)', () => {
    const index = indexOf([located('near', M111, 'photo')]);
    // ~111m: inside the default, dropped once the radius tightens to 80m.
    expect(
      computeNearby(index, assetsOf(['near']), origin).photos.map((p) => p.asset.id)
    ).toEqual(['near']);
    expect(computeNearby(index, assetsOf(['near']), origin, 80).photos).toEqual([]);
  });

  it('keeps photos within the radius and drops the rest', () => {
    const index = indexOf([located('near', M111, 'photo'), located('far', M1112, 'photo')]);
    const { photos } = computeNearby(index, assetsOf(['near', 'far']), origin);
    expect(photos.map((p) => p.asset.id)).toEqual(['near']);
  });

  it('drops a real-GPS video ~445m away (the high-school case; was inside the old 1000m)', () => {
    const index = indexOf([located('hs-video', M445, 'video')]);
    const { videos } = computeNearby(index, assetsOf(['hs-video']), origin);
    expect(videos).toEqual([]);
  });

  it('keeps a video within the radius', () => {
    const index = indexOf([located('close-video', M111, 'video')]);
    const { videos } = computeNearby(index, assetsOf(['close-video']), origin);
    expect(videos.map((v) => v.asset.id)).toEqual(['close-video']);
  });

  it('applies the same radius to estimated (GPS-less) videos', () => {
    // The unlocated video borrows its nearest-in-time photo's location; with the
    // only anchor ~1112m away, the estimate lands outside the radius → excluded.
    const index: AssetIndex = {
      located: [located('far-anchor', M1112, 'photo', 5000)],
      unlocatedVideos: [{ id: 'uv', creationTime: 5000 }],
      processedIds: ['far-anchor', 'uv'],
    };
    const { videos } = computeNearby(index, assetsOf(['far-anchor', 'uv']), origin);
    expect(videos).toEqual([]);
  });

  it('includes an estimated video when its anchor is within the radius', () => {
    const index: AssetIndex = {
      located: [located('near-anchor', M111, 'photo', 5000)],
      unlocatedVideos: [{ id: 'uv2', creationTime: 5000 }],
      processedIds: ['near-anchor', 'uv2'],
    };
    const { videos } = computeNearby(index, assetsOf(['near-anchor', 'uv2']), origin);
    expect(videos.map((v) => v.asset.id)).toEqual(['uv2']);
    expect(videos[0].isEstimated).toBe(true);
  });
});
