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

// Bound the metadata caches so they can't grow one entry per asset forever
// across a huge library (every card that scrolls past writes to them). FIFO:
// once a map is full, drop the oldest entry before inserting a new key. The
// values are tiny and cheap to re-derive on a future revisit, so eviction is
// invisible. The in-flight maps self-clean (deleted in `finally`) and are
// inherently small, so they don't need this.
const MAX_METADATA_ENTRIES = 5000;
function cappedSet<V>(map: Map<string, V>, key: string, value: V): void {
  if (!map.has(key) && map.size >= MAX_METADATA_ENTRIES) {
    const oldest = map.keys().next().value;
    if (oldest !== undefined) map.delete(oldest);
  }
  map.set(key, value);
}

export type AssetTimeLocation = {
  creationTime: number | null;
  location: AssetLocation | null;
};

// First strictly-positive timestamp. MediaStore reports `0` (epoch) for photos
// with no DATE_TAKEN (screenshots, downloads, saved images), and `0 ?? next`
// would keep the 0 — so we can't use `??`. This is why dates sometimes went
// blank on Android.
function firstValidTime(...candidates: (number | null | undefined)[]): number | null {
  for (const c of candidates) {
    if (c != null && c > 0) return c;
  }
  return null;
}

export function getCachedMetadata(assetId: string): AssetMetadata | undefined {
  return fullCache.get(assetId);
}

const inCloudCache = new Map<string, boolean>();
const inCloudInflight = new Map<string, Promise<boolean>>();

/** Synchronous read of a previously-checked iCloud status; undefined if never
 *  checked. Non-iOS platforms have no iCloud, so everything reads as local. */
export function getCachedIsInCloud(assetId: string): boolean | undefined {
  if (Platform.OS !== 'ios') return false;
  return inCloudCache.get(assetId);
}

// True when the photo's original is iCloud-resident (not on device), meaning
// rendering it requires a network download first. iOS-only signal — Android
// has no equivalent, so everything counts as local there. Errors also resolve
// to local, so a failed check can only over-include a photo, never hide it.
export async function loadAssetIsInCloud(asset: Asset): Promise<boolean> {
  if (Platform.OS !== 'ios') return false;
  const cached = inCloudCache.get(asset.id);
  if (cached !== undefined) return cached;
  const existing = inCloudInflight.get(asset.id);
  if (existing) return existing;

  const p = (async () => {
    try {
      const inCloud = await asset.getIsInCloud().catch(() => false);
      cappedSet(inCloudCache, asset.id, inCloud);
      return inCloud;
    } finally {
      inCloudInflight.delete(asset.id);
    }
  })();
  inCloudInflight.set(asset.id, p);
  return p;
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
      // Let a thrown native read propagate (and stay uncached) so it can be
      // retried — do NOT `.catch(() => null)` here. Collapsing a failed read
      // into a cached `null` is what made the first photo on a cold launch
      // lose its caption forever: the framework isn't warm for that very first
      // read, it throws, the `null` gets cached, and every retry then short-
      // circuits to it. A *successfully* read `null` (a photo with no GPS) is
      // still cached below so those aren't re-read.
      const loc = await asset.getLocation();
      cappedSet(locationCache, asset.id, loc);
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
      // Same as loadAssetLocation: a thrown read must propagate uncached so it
      // can be retried. A successfully read value (including 0/null) is cached.
      const t = await asset.getCreationTime();
      cappedSet(timeCache, asset.id, t);
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
        // Resolve each read into an {ok} result so a thrown native read — common
        // for the very first read right after a cold launch, before the Photos
        // framework is warm — is distinguished from a legitimately-absent value.
        // getMediaType isn't caption-critical, so a failure there just falls back
        // to UNKNOWN and never blocks the date/place.
        const [mediaType, ctRes, locRes] = await Promise.all([
          asset.getMediaType().catch(() => MediaType.UNKNOWN),
          loadAssetCreationTime(asset).then(
            (v): { ok: boolean; v: number | null } => ({ ok: true, v }),
            (): { ok: boolean; v: number | null } => ({ ok: false, v: null })
          ),
          (locationCache.has(asset.id)
            ? Promise.resolve(locationCache.get(asset.id) ?? null)
            : loadAssetLocation(asset)
          ).then(
            (v): { ok: boolean; v: AssetLocation | null } => ({ ok: true, v }),
            (): { ok: boolean; v: AssetLocation | null } => ({ ok: false, v: null })
          ),
        ]);
        // Fall back to modification time if the asset has no (valid) creation
        // time, so the date is always present.
        const creationTime =
          firstValidTime(ctRes.v) ?? (await asset.getModificationTime().catch(() => null));
        const meta: AssetMetadata = {
          uri: asset.id,
          creationTime,
          location: locRes.v,
          mediaType,
        };
        // Cache only when both native reads actually succeeded. If either threw
        // (cold-launch race), still return this best-effort meta so the card
        // shows whatever we have, but leave it UNCACHED so useAssetMetadata
        // re-attempts and the caption recovers once the framework is warm —
        // instead of a failed read poisoning the cache for the whole session.
        // A successful read of an absent value (a photo with no GPS) counts as
        // ok and is cached, so those aren't re-read.
        if (ctRes.ok && locRes.ok) cappedSet(fullCache, asset.id, meta);
        return meta;
      }

      const [info, mediaType, locationFromCache] = await Promise.all([
        asset.getInfo().catch(() => null),
        asset.getMediaType().catch(() => MediaType.UNKNOWN),
        locationCache.has(asset.id)
          ? Promise.resolve(locationCache.get(asset.id) ?? null)
          : asset.getLocation().catch(() => null),
      ]);
      // Resolve with whatever we got rather than rejecting: a thrown getInfo()
      // used to leave meta null forever (retries exhausted), which kept the
      // card invisible. Many Android assets also report creationTime 0 (or
      // null); fall back to modificationTime so the date isn't blank.
      const creationTime = info
        ? firstValidTime(info.creationTime, info.modificationTime)
        : null;
      const meta: AssetMetadata = {
        uri: info?.uri ?? asset.id,
        creationTime,
        location: locationFromCache,
        mediaType,
      };
      cappedSet(fullCache, asset.id, meta);
      if (!locationCache.has(asset.id)) cappedSet(locationCache, asset.id, meta.location);
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
  // Derived rather than synced: the cache is the source of truth, and the
  // keyed `fetched` record only fills the gap until hydrateAsset populates it.
  // A changed/null asset simply stops matching — no setState-in-effect resets.
  const [fetched, setFetched] = useState<{ id: string; meta: AssetMetadata } | null>(
    null
  );

  useEffect(() => {
    if (!asset) return;
    // NOTE: do NOT early-return when `fullCache.has(asset.id)`. If the feed warms
    // this photo (warmAssetMetadata → hydrateAsset) into fullCache *between* this
    // card's first render (which returned null on an empty cache) and this effect
    // running, an early return here would skip setFetched — and nothing would
    // re-render. The render reads fullCache non-reactively, and with React
    // Compiler on, the memoized return (keyed on asset.id + fetched, both
    // unchanged) stays the stale null, so the caption never appears. Always
    // running tryHydrate guarantees setFetched fires (hydrateAsset returns the
    // cached meta instantly when present), syncing `fetched` and surfacing it.
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;
    // A few patient retries with backoff (~4s total at 400*attempt) so a read
    // that throws because the Photos framework isn't warm yet on cold launch
    // gets re-attempted once it is — rather than leaving the card captionless.
    const maxAttempts = 5;

    const scheduleRetry = () => {
      attempt += 1;
      if (attempt < maxAttempts) retryTimer = setTimeout(tryHydrate, 400 * attempt);
    };
    const tryHydrate = () => {
      hydrateAsset(asset)
        .then((m) => {
          if (cancelled) return;
          // Surface only a COMPLETE result. hydrateAsset caches a meta only when
          // both native reads succeeded, so `fullCache.has` is the "real data"
          // signal. A best-effort meta from a cold read has creationTime null;
          // surfacing it would fade the caption in blank and pop the date in
          // later. Keep `meta` null (caption stays hidden) and retry until warm.
          if (fullCache.has(asset.id)) setFetched({ id: asset.id, meta: m });
          else scheduleRetry();
        })
        .catch(() => {
          if (!cancelled) scheduleRetry();
        });
    };
    tryHydrate();

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [asset]);

  if (!asset) return null;
  return (
    fullCache.get(asset.id) ?? (fetched?.id === asset.id ? fetched.meta : null)
  );
}
