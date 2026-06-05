import { Asset, MediaType } from 'expo-media-library';

import { loadAssetTimeLocation } from '@/hooks/use-asset-metadata';
import { persistedFile, readPersisted } from '@/lib/persisted-file';

// Shared, persisted index of every asset's location/time/type. This is the
// single expensive pass (one native metadata read per asset) that both the
// Near Me radius query and the geofence clustering build on. Built once,
// cached on disk, and updated INCREMENTALLY when the library changes (only
// newly-added assets are located, deleted ones dropped) — so after the first
// build, "photos near here" and "clusters" are instant in-memory math and a
// new photo never forces a full re-scan.

const INDEX_FILE = 'located-assets.json';
const HYDRATE_CONCURRENCY = 4;

export type LocatedAsset = {
  id: string;
  lat: number;
  lng: number;
  creationTime: number | null;
  mediaType: MediaType;
};

// Videos that have a timestamp but no GPS. Kept so Near Me can estimate their
// location from nearby photos taken around the same time (parity with the old
// scan's behavior).
export type UnlocatedVideo = {
  id: string;
  creationTime: number;
};

export type AssetIndex = {
  located: LocatedAsset[];
  unlocatedVideos: UnlocatedVideo[];
  // Every asset id we've already examined (including ones with no location at
  // all), so incremental syncs can skip them.
  processedIds: string[];
};

let cached: AssetIndex | null = null;
let syncedFor: Asset[] | null = null;
let inflight: Promise<AssetIndex> | null = null;

async function loadFromDisk(): Promise<AssetIndex | null> {
  try {
    const text = await readPersisted(INDEX_FILE);
    if (text == null) return null;
    const parsed = JSON.parse(text);
    if (
      parsed &&
      Array.isArray(parsed.located) &&
      Array.isArray(parsed.unlocatedVideos) &&
      Array.isArray(parsed.processedIds)
    ) {
      return parsed as AssetIndex;
    }
    return null;
  } catch {
    return null;
  }
}

function saveToDisk(index: AssetIndex): void {
  try {
    const file = persistedFile(INDEX_FILE);
    if (!file.exists) file.create();
    file.write(JSON.stringify(index));
  } catch {
    // ignore — in-memory cache stays authoritative
  }
}

type LocateResult =
  | { kind: 'located'; value: LocatedAsset }
  | { kind: 'unlocatedVideo'; value: UnlocatedVideo }
  | { kind: 'none' };

async function locate(asset: Asset): Promise<LocateResult> {
  try {
    const [tl, mediaType] = await Promise.all([
      loadAssetTimeLocation(asset),
      asset.getMediaType().catch(() => null),
    ]);
    const mt = mediaType ?? MediaType.IMAGE;
    if (tl.location) {
      return {
        kind: 'located',
        value: {
          id: asset.id,
          lat: tl.location.latitude,
          lng: tl.location.longitude,
          creationTime: tl.creationTime,
          mediaType: mt,
        },
      };
    }
    if (mt === MediaType.VIDEO && tl.creationTime != null) {
      return {
        kind: 'unlocatedVideo',
        value: { id: asset.id, creationTime: tl.creationTime },
      };
    }
    return { kind: 'none' };
  } catch {
    return { kind: 'none' };
  }
}

async function locateAll(assets: Asset[]): Promise<LocateResult[]> {
  const out: LocateResult[] = [];
  for (let i = 0; i < assets.length; i += HYDRATE_CONCURRENCY) {
    const batch = assets.slice(i, i + HYDRATE_CONCURRENCY);
    const results = await Promise.all(batch.map(locate));
    out.push(...results);
    // Yield between batches so the bulk metadata load doesn't block the JS
    // thread / starve other MediaLibrary consumers.
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return out;
}

// Reconcile the existing index to the current asset list: locate only assets
// we haven't processed before, and drop entries for assets that no longer
// exist. Returns the same object reference when nothing changed.
async function sync(base: AssetIndex | null, assets: Asset[]): Promise<AssetIndex> {
  if (!base) {
    const results = await locateAll(assets);
    const located: LocatedAsset[] = [];
    const unlocatedVideos: UnlocatedVideo[] = [];
    for (const r of results) {
      if (r.kind === 'located') located.push(r.value);
      else if (r.kind === 'unlocatedVideo') unlocatedVideos.push(r.value);
    }
    return { located, unlocatedVideos, processedIds: assets.map((a) => a.id) };
  }

  const currentIds = new Set(assets.map((a) => a.id));
  const processed = new Set(base.processedIds);
  const toAdd = assets.filter((a) => !processed.has(a.id));
  const hasRemovals = base.processedIds.some((id) => !currentIds.has(id));

  if (toAdd.length === 0 && !hasRemovals) return base;

  const located = base.located.filter((l) => currentIds.has(l.id));
  const unlocatedVideos = base.unlocatedVideos.filter((v) => currentIds.has(v.id));
  const processedIds = base.processedIds.filter((id) => currentIds.has(id));

  if (toAdd.length > 0) {
    const results = await locateAll(toAdd);
    for (const r of results) {
      if (r.kind === 'located') located.push(r.value);
      else if (r.kind === 'unlocatedVideo') unlocatedVideos.push(r.value);
    }
    for (const a of toAdd) processedIds.push(a.id);
  }

  return { located, unlocatedVideos, processedIds };
}

export async function ensureIndex(assets: Asset[]): Promise<AssetIndex> {
  if (cached && syncedFor === assets) return cached;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const base = cached ?? (await loadFromDisk());
      const result = await sync(base, assets);
      if (result !== base) saveToDisk(result);
      cached = result;
      syncedFor = assets;
      return cached;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

export function getIndex(): AssetIndex | null {
  return cached;
}

export async function loadIndexFromDisk(): Promise<AssetIndex | null> {
  if (cached) return cached;
  const fromDisk = await loadFromDisk();
  // Populate the module cache so getIndex() works on cold-start paths (e.g. a
  // notification tap that opens straight into a cluster before Near Me runs).
  if (fromDisk) cached = fromDisk;
  return cached;
}

// Force a full rebuild on the next ensureIndex (manual "refresh" only — normal
// library changes are handled incrementally and don't need this).
export function invalidateIndex(): void {
  cached = null;
  syncedFor = null;
}
