import { useEffect, useState } from 'react';

import { type Asset, MediaType } from 'expo-media-library';

import {
  AssetLocation,
  loadAssetTimeLocation,
} from '@/hooks/use-asset-metadata';
import { distanceMeters } from '@/utils/distance';

export const PHOTO_RADIUS_METERS = 50;
export const VIDEO_RADIUS_METERS = 200;
const SCAN_BATCH = 100;
const ESTIMATE_WINDOW_MS = 30 * 60 * 1000;
const ORIGIN_CHANGE_THRESHOLD_METERS = 25;

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
  scanned: number;
  total: number;
  photos: NearbyAsset[];
  videos: NearbyAsset[];
};

type Origin = { latitude: number; longitude: number } | null;

type Cache = {
  origin: { latitude: number; longitude: number };
  scannedIds: Set<string>;
  anchors: Array<{ creationTime: number; location: AssetLocation }>;
  photos: NearbyAsset[];
  videos: NearbyAsset[];
};

let cache: Cache | null = null;
let scanInflight = false;
let lastTotal = 0;
let lastScanned = 0;
const subscribers = new Set<() => void>();

function notify() {
  for (const fn of subscribers) fn();
}

function originDrift(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number }
) {
  return distanceMeters(a, b);
}

async function runScan(assets: Asset[], origin: { latitude: number; longitude: number }) {
  if (scanInflight) return;

  if (cache && originDrift(cache.origin, origin) > ORIGIN_CHANGE_THRESHOLD_METERS) {
    cache = null;
  }
  if (!cache) {
    cache = {
      origin,
      scannedIds: new Set(),
      anchors: [],
      photos: [],
      videos: [],
    };
  }

  const toScan = assets.filter((a) => !cache!.scannedIds.has(a.id));
  if (toScan.length === 0) {
    lastTotal = assets.length;
    lastScanned = assets.length;
    notify();
    return;
  }

  scanInflight = true;
  lastTotal = assets.length;
  lastScanned = assets.length - toScan.length;
  notify();

  try {
    for (let i = 0; i < toScan.length; i += SCAN_BATCH) {
      if (!cache) return;
      const batch = toScan.slice(i, i + SCAN_BATCH);
      const resolved = await Promise.all(
        batch.map(async (a) => {
          const [{ creationTime, location }, mediaType] = await Promise.all([
            loadAssetTimeLocation(a),
            a.getMediaType().catch(() => null),
          ]);
          return { asset: a, creationTime, location, mediaType };
        })
      );
      if (!cache) return;

      const newlyUnlocatedVideos: typeof resolved = [];
      for (const r of resolved) {
        cache.scannedIds.add(r.asset.id);
        if (r.location) {
          const d = distanceMeters(r.location, origin);
          if (r.mediaType === MediaType.IMAGE) {
            if (r.creationTime != null) {
              cache.anchors.push({ creationTime: r.creationTime, location: r.location });
            }
            if (d <= PHOTO_RADIUS_METERS) {
              cache.photos.push({
                asset: r.asset,
                location: r.location,
                distance: d,
                isEstimated: false,
                mediaType: MediaType.IMAGE,
                creationTime: r.creationTime,
              });
            }
          } else if (r.mediaType === MediaType.VIDEO) {
            if (d <= VIDEO_RADIUS_METERS) {
              cache.videos.push({
                asset: r.asset,
                location: r.location,
                distance: d,
                isEstimated: false,
                mediaType: MediaType.VIDEO,
                creationTime: r.creationTime,
              });
            }
          }
        } else if (r.mediaType === MediaType.VIDEO && r.creationTime != null) {
          newlyUnlocatedVideos.push(r);
        }
      }

      if (newlyUnlocatedVideos.length > 0 && cache.anchors.length > 0) {
        const sortedAnchors = [...cache.anchors].sort((a, b) => a.creationTime - b.creationTime);
        const anchorTimes = sortedAnchors.map((a) => a.creationTime);
        for (const r of newlyUnlocatedVideos) {
          const idx = nearestIndex(anchorTimes, r.creationTime!);
          const anchor = sortedAnchors[idx];
          const dt = Math.abs(anchor.creationTime - r.creationTime!);
          if (dt > ESTIMATE_WINDOW_MS) continue;
          const d = distanceMeters(anchor.location, origin);
          if (d > VIDEO_RADIUS_METERS) continue;
          cache.videos.push({
            asset: r.asset,
            location: anchor.location,
            distance: d,
            isEstimated: true,
            mediaType: MediaType.VIDEO,
            creationTime: r.creationTime,
          });
        }
      }

      cache.photos.sort((a, b) => a.distance - b.distance);
      cache.videos.sort((a, b) => a.distance - b.distance);

      lastScanned += batch.length;
      notify();
    }
  } finally {
    scanInflight = false;
    notify();
  }
}

export function refreshNearby() {
  cache = null;
  lastTotal = 0;
  lastScanned = 0;
  notify();
}

export function useNearbyAssets(assets: Asset[] | null, origin: Origin): NearbyState {
  const [, rerender] = useState({});

  useEffect(() => {
    const fn = () => rerender({});
    subscribers.add(fn);
    return () => {
      subscribers.delete(fn);
    };
  }, []);

  useEffect(() => {
    if (!assets || !origin) return;
    runScan(assets, origin);
  }, [assets, origin?.latitude, origin?.longitude]);

  if (!cache) {
    return { status: 'idle', scanned: 0, total: 0, photos: [], videos: [] };
  }
  return {
    status: scanInflight ? 'scanning' : 'ready',
    scanned: lastScanned,
    total: lastTotal,
    photos: cache.photos,
    videos: cache.videos,
  };
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
