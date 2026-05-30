import { useEffect, useMemo, useRef, useState } from 'react';

import { type Asset, MediaType } from 'expo-media-library';

import { AssetLocation } from '@/hooks/use-asset-metadata';
import {
  ensureIndex,
  getIndex,
  invalidateIndex,
  type AssetIndex,
} from '@/hooks/use-located-assets';
import { distanceMeters } from '@/utils/distance';

// Near Me deliberately casts a wide net ("photos around this area"), in
// contrast to the memories story which is scoped to a tight ~50m cluster cell.
// Tune these two if Near Me feels too broad or too narrow.
export const PHOTO_RADIUS_METERS = 500;
export const VIDEO_RADIUS_METERS = 1000;
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

// Building the shared index is the only slow part (first run / library
// change); querying it for "near here" is pure in-memory math, so we no
// longer scan progressively — results are computed at once.
let building = false;
let latestAssets: Asset[] | null = null;
const subscribers = new Set<() => void>();

function notify() {
  for (const fn of subscribers) fn();
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

function computeNearby(
  index: AssetIndex,
  assets: Asset[],
  origin: { latitude: number; longitude: number }
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
      if (d <= VIDEO_RADIUS_METERS) {
        videos.push({
          asset,
          location,
          distance: d,
          isEstimated: false,
          mediaType: MediaType.VIDEO,
          creationTime: la.creationTime,
        });
      }
    } else {
      if (la.creationTime != null) anchors.push({ creationTime: la.creationTime, location });
      if (d <= PHOTO_RADIUS_METERS) {
        photos.push({
          asset,
          location,
          distance: d,
          isEstimated: false,
          mediaType: MediaType.IMAGE,
          creationTime: la.creationTime,
        });
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
      if (d > VIDEO_RADIUS_METERS) continue;
      videos.push({
        asset,
        location: anchor.location,
        distance: d,
        isEstimated: true,
        mediaType: MediaType.VIDEO,
        creationTime: uv.creationTime,
      });
    }
  }

  return { photos, videos };
}

export function refreshNearby() {
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
    return computeNearby(index, assets, origin);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, assets, origin?.latitude, origin?.longitude]);

  let status: NearbyState['status'];
  if (!assets || !origin) status = 'idle';
  else if (!index || building) status = 'scanning';
  else status = 'ready';

  return { status, photos, videos };
}
