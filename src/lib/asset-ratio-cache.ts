// Shared cache of each asset's intrinsic aspect ratio (width / height), keyed by
// asset id. The Near Me grid decodes every tile's poster via expo-image anyway,
// whose onLoad reports the source's intrinsic dimensions regardless of
// contentFit — so the grid records the ratio here for free as tiles load. The
// viewer then SEEDS its frame from this cache on open, so a video (or photo)
// opens already at its true shape instead of defaulting to 3:4 and resizing a
// beat later (the "zoom out" snap). Since you must see a tile to tap it, the
// poster is essentially always loaded by tap time, so the cache hits.
//
// Ratios never change for an asset, so there's no invalidation. FIFO-capped so a
// huge library can't grow it unbounded (mirrors `cappedSet` in
// hooks/use-asset-metadata.ts).
const MAX_RATIO_ENTRIES = 3000;
const cache = new Map<string, number>();

export function getAssetRatio(id: string): number | undefined {
  return cache.get(id);
}

export function setAssetRatio(id: string, ratio: number): void {
  if (!Number.isFinite(ratio) || ratio <= 0) return;
  if (!cache.has(id) && cache.size >= MAX_RATIO_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(id, ratio);
}
