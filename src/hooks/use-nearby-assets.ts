import { useEffect, useMemo, useRef, useState } from 'react';

import { type Asset, MediaType } from 'expo-media-library';

import { AssetLocation } from '@/hooks/use-asset-metadata';
import {
  ensureIndex,
  getIndex,
  invalidateIndex,
  type AssetIndex,
} from '@/hooks/use-located-assets';
import { getClusters } from '@/hooks/use-photo-clusters';
import { NEARME_OPTS, relevanceRadiusFor } from '@/lib/relevance-radius';
import { distanceMeters } from '@/utils/distance';

// Near Me shows what you took right where you're standing — meant to feel like
// walking around campus, so it's tight: ~150m, roughly the building cluster
// you're in, not the whole neighborhood. One radius for photos and videos alike:
// videos used to reach twice as far (1000m vs 500m), which surfaced real-GPS
// clips from ~a mile away (e.g. an old high school). This is now the DEFAULT /
// fallback radius: the hook passes computeNearby a density-adapted radius
// (NEARME_OPTS in @/lib/relevance-radius) that tightens where your photo
// clusters pack close and widens where they're spread out. Tune this fallback
// if Near Me feels too broad or too narrow.
export const NEAR_ME_RADIUS_METERS = 150;
const ESTIMATE_WINDOW_MS = 30 * 60 * 1000;

export type NearbyAsset = {
  asset: Asset;
  location: AssetLocation;
  distance: number;
  isEstimated: boolean;
  mediaType: MediaType;
  creationTime: number | null;
};

export type NearbyState = {
  status: 'idle' | 'scanning' | 'ready';
  photos: NearbyAsset[];
  videos: NearbyAsset[];
};

type Origin = { latitude: number; longitude: number } | null;

// Pure: merge the nearby photos and videos into one list, newest first. The
// scan surfaces matches newest-first, so a creation-time sort keeps a stable
// order as results settle (no reshuffling to the top). Missing/zero
// creationTime is treated as oldest, so undated items sink to the bottom
// instead of jumping ahead of real dates. Array.prototype.sort is stable
// (ES2019+), so equal timestamps preserve input order (photos before videos).
export function mergeNearbyByRecency(
  photos: NearbyAsset[],
  videos: NearbyAsset[]
): NearbyAsset[] {
  const merged = [...photos, ...videos];
  merged.sort((a, b) => (b.creationTime ?? 0) - (a.creationTime ?? 0));
  return merged;
}

// Building the shared index is the only slow part (first run / library
// change); querying it for "near here" is pure in-memory math, so we no
// longer scan progressively — results are computed at once.
let building = false;
let latestAssets: Asset[] | null = null;
const subscribers = new Set<() => void>();

function notify() {
  for (const fn of subscribers) fn();
}

// Identity-stable NearbyAsset objects. computeNearby runs again whenever the
// asset list changes reference; without reuse it would mint a brand-new object
// for every nearby asset each time, so every grid cell's `memo` would miss and
// the tile would re-render (and flicker). We keep the previous object whenever
// the fields the UI actually reads are unchanged. The stale `asset` reference
// it carries is fine — only `asset.id` is used for rendering, and that's part
// of the equality check.
const objCache = new Map<string, NearbyAsset>();

export function sameNearby(a: NearbyAsset, b: NearbyAsset): boolean {
  return (
    a.asset.id === b.asset.id &&
    a.location.latitude === b.location.latitude &&
    a.location.longitude === b.location.longitude &&
    a.distance === b.distance &&
    a.isEstimated === b.isEstimated &&
    a.creationTime === b.creationTime &&
    a.mediaType === b.mediaType
  );
}

function stableNearby(next: NearbyAsset): NearbyAsset {
  const prev = objCache.get(next.asset.id);
  if (prev && sameNearby(prev, next)) return prev;
  objCache.set(next.asset.id, next);
  return next;
}

function nearestIndex(sortedTimes: number[], target: number): number {
  let lo = 0;
  let hi = sortedTimes.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sortedTimes[mid] < target) lo = mid + 1;
    else hi = mid;
  }
  if (lo > 0 && Math.abs(sortedTimes[lo - 1] - target) < Math.abs(sortedTimes[lo] - target)) {
    return lo - 1;
  }
  return lo;
}

export function computeNearby(
  index: AssetIndex,
  assets: Asset[],
  origin: { latitude: number; longitude: number },
  radiusM: number = NEAR_ME_RADIUS_METERS
): { photos: NearbyAsset[]; videos: NearbyAsset[] } {
  const byId = new Map(assets.map((a) => [a.id, a]));
  const photos: NearbyAsset[] = [];
  const videos: NearbyAsset[] = [];
  // Every located photo is an anchor for estimating GPS-less videos by time.
  const anchors: { creationTime: number; location: AssetLocation }[] = [];

  for (const la of index.located) {
    const asset = byId.get(la.id);
    if (!asset) continue;
    const location: AssetLocation = { latitude: la.lat, longitude: la.lng };
    const d = distanceMeters(location, origin);
    if (la.mediaType === MediaType.VIDEO) {
      if (d <= radiusM) {
        videos.push(
          stableNearby({
            asset,
            location,
            distance: d,
            isEstimated: false,
            mediaType: MediaType.VIDEO,
            creationTime: la.creationTime,
          })
        );
      }
    } else {
      if (la.creationTime != null) anchors.push({ creationTime: la.creationTime, location });
      if (d <= radiusM) {
        photos.push(
          stableNearby({
            asset,
            location,
            distance: d,
            isEstimated: false,
            mediaType: MediaType.IMAGE,
            creationTime: la.creationTime,
          })
        );
      }
    }
  }

  if (index.unlocatedVideos.length > 0 && anchors.length > 0) {
    const sorted = [...anchors].sort((a, b) => a.creationTime - b.creationTime);
    const times = sorted.map((a) => a.creationTime);
    for (const uv of index.unlocatedVideos) {
      const asset = byId.get(uv.id);
      if (!asset) continue;
      const idx = nearestIndex(times, uv.creationTime);
      const anchor = sorted[idx];
      if (!anchor) continue;
      if (Math.abs(anchor.creationTime - uv.creationTime) > ESTIMATE_WINDOW_MS) continue;
      const d = distanceMeters(anchor.location, origin);
      if (d > radiusM) continue;
      videos.push(
        stableNearby({
          asset,
          location: anchor.location,
          distance: d,
          isEstimated: true,
          mediaType: MediaType.VIDEO,
          creationTime: uv.creationTime,
        })
      );
    }
  }

  return { photos, videos };
}

export function refreshNearby() {
  // A manual refresh rebuilds from scratch, so drop the identity cache too —
  // otherwise a since-edited asset could keep a stale reused object.
  objCache.clear();
  invalidateIndex();
  if (!latestAssets) {
    notify();
    return;
  }
  building = true;
  notify();
  ensureIndex(latestAssets)
    .catch(() => {})
    .finally(() => {
      building = false;
      notify();
    });
}

export function useNearbyAssets(assets: Asset[] | null, origin: Origin): NearbyState {
  const [, rerender] = useState({});
  const prevAssets = useRef<Asset[] | null>(null);

  useEffect(() => {
    const fn = () => rerender({});
    subscribers.add(fn);
    return () => {
      subscribers.delete(fn);
    };
  }, []);

  useEffect(() => {
    if (!assets) return;
    latestAssets = assets;
    prevAssets.current = assets;

    // ensureIndex reconciles incrementally (locates only new assets, drops
    // deleted ones), so a library change never forces a full re-scan. Only
    // block the grid with a spinner when there's no index yet (first build);
    // incremental syncs update in place without a loading state.
    let cancelled = false;
    const hadIndex = getIndex() != null;
    if (!hadIndex) {
      building = true;
      notify();
    }
    ensureIndex(assets)
      .catch(() => {})
      .finally(() => {
        if (cancelled) return;
        building = false;
        notify();
      });
    return () => {
      cancelled = true;
    };
  }, [assets]);

  const index = getIndex();
  const { photos, videos } = useMemo(() => {
    if (!index || !assets || !origin) return { photos: [], videos: [] };
    // Tighten in dense areas / widen in sparse ones, keyed on the spacing of
    // your photo clusters around where you're standing. getClusters() derives
    // from the same index, so this recomputes whenever the index (a dep) changes.
    const radiusM = relevanceRadiusFor(
      origin.latitude,
      origin.longitude,
      getClusters() ?? [],
      NEARME_OPTS
    );
    return computeNearby(index, assets, origin, radiusM);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, assets, origin?.latitude, origin?.longitude]);

  let status: NearbyState['status'];
  if (!assets || !origin) status = 'idle';
  else if (!index || building) status = 'scanning';
  else status = 'ready';

  return { status, photos, videos };
}
