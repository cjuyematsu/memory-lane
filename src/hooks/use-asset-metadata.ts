import { useEffect, useState } from 'react';
import { Platform } from 'react-native';

import { Asset, MediaType } from 'expo-media-library';

export type AssetLocation = { latitude: number; longitude: number };

export type AssetMetadata = {
  uri: string;
  creationTime: number | null;
  location: AssetLocation | null;
  mediaType: MediaType;
};

const fullCache = new Map<string, AssetMetadata>();
const fullInflight = new Map<string, Promise<AssetMetadata>>();

const locationCache = new Map<string, AssetLocation | null>();
const locationInflight = new Map<string, Promise<AssetLocation | null>>();

const timeCache = new Map<string, number | null>();
const timeInflight = new Map<string, Promise<number | null>>();

export type AssetTimeLocation = {
  creationTime: number | null;
  location: AssetLocation | null;
};

export function getCachedMetadata(assetId: string): AssetMetadata | undefined {
  return fullCache.get(assetId);
}

export function getCachedLocation(assetId: string): AssetLocation | null | undefined {
  if (locationCache.has(assetId)) return locationCache.get(assetId);
  const full = fullCache.get(assetId);
  return full ? full.location : undefined;
}

export async function loadAssetLocation(asset: Asset): Promise<AssetLocation | null> {
  const cachedFull = fullCache.get(asset.id);
  if (cachedFull) return cachedFull.location;
  if (locationCache.has(asset.id)) return locationCache.get(asset.id) ?? null;
  const existing = locationInflight.get(asset.id);
  if (existing) return existing;

  const p = (async () => {
    try {
      const loc = await asset.getLocation().catch(() => null);
      locationCache.set(asset.id, loc);
      return loc;
    } finally {
      locationInflight.delete(asset.id);
    }
  })();
  locationInflight.set(asset.id, p);
  return p;
}

export async function loadAssetCreationTime(asset: Asset): Promise<number | null> {
  const cachedFull = fullCache.get(asset.id);
  if (cachedFull) return cachedFull.creationTime;
  if (timeCache.has(asset.id)) return timeCache.get(asset.id) ?? null;
  const existing = timeInflight.get(asset.id);
  if (existing) return existing;

  const p = (async () => {
    try {
      const t = await asset.getCreationTime().catch(() => null);
      timeCache.set(asset.id, t);
      return t;
    } finally {
      timeInflight.delete(asset.id);
    }
  })();
  timeInflight.set(asset.id, p);
  return p;
}

export async function loadAssetTimeLocation(asset: Asset): Promise<AssetTimeLocation> {
  const [creationTime, location] = await Promise.all([
    loadAssetCreationTime(asset),
    loadAssetLocation(asset),
  ]);
  return { creationTime, location };
}

export async function hydrateAsset(asset: Asset): Promise<AssetMetadata> {
  const cached = fullCache.get(asset.id);
  if (cached) return cached;
  const existing = fullInflight.get(asset.id);
  if (existing) return existing;

  const p = (async () => {
    try {
      if (Platform.OS === 'ios') {
        const [mediaType, creationTime, location] = await Promise.all([
          asset.getMediaType(),
          loadAssetCreationTime(asset),
          locationCache.has(asset.id)
            ? Promise.resolve(locationCache.get(asset.id) ?? null)
            : loadAssetLocation(asset),
        ]);
        const meta: AssetMetadata = {
          uri: asset.id,
          creationTime,
          location,
          mediaType,
        };
        fullCache.set(asset.id, meta);
        return meta;
      }

      const [info, mediaType, locationFromCache] = await Promise.all([
        asset.getInfo(),
        asset.getMediaType(),
        locationCache.has(asset.id)
          ? Promise.resolve(locationCache.get(asset.id) ?? null)
          : asset.getLocation().catch(() => null),
      ]);
      const meta: AssetMetadata = {
        uri: info.uri,
        creationTime: info.creationTime,
        location: locationFromCache,
        mediaType,
      };
      fullCache.set(asset.id, meta);
      if (!locationCache.has(asset.id)) locationCache.set(asset.id, meta.location);
      return meta;
    } finally {
      fullInflight.delete(asset.id);
    }
  })();
  fullInflight.set(asset.id, p);
  return p;
}

// expo-video handles `ph://` URIs via PHImageManager with iCloud download
// enabled. Resolving to a raw AVURLAsset path (asset.getUri) drops those
// permissions and fails silently for iCloud-resident videos.
export function usePlaybackUri(asset: Asset | null): string | null {
  return asset ? asset.id : null;
}

export function useAssetMetadata(asset: Asset | null): AssetMetadata | null {
  const [meta, setMeta] = useState<AssetMetadata | null>(() =>
    asset ? fullCache.get(asset.id) ?? null : null
  );

  useEffect(() => {
    if (!asset) {
      setMeta(null);
      return;
    }
    const cached = fullCache.get(asset.id);
    if (cached) {
      setMeta(cached);
      return;
    }
    let cancelled = false;
    hydrateAsset(asset)
      .then((m) => {
        if (!cancelled) setMeta(m);
      })
      .catch(() => {
        // asset disappeared; leave as null
      });
    return () => {
      cancelled = true;
    };
  }, [asset]);

  return meta;
}
