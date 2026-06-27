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
// Concurrency for small / incremental syncs (a few new photos after the first
// build) — kept modest since they overlap nothing.
const HYDRATE_CONCURRENCY = 4;
// The big first build is DEFERRED past the feed's first paint and shows visible
// progress, so it can run wider to finish the one-time setup sooner. Metadata
// reads go through a different native path than image downloads, so this doesn't
// starve the feed. A tiny breather still yields a frame between batches.
const LARGE_SWEEP_THRESHOLD = 200;
const LARGE_SWEEP_CONCURRENCY = 8;
const LARGE_SWEEP_DELAY_MS = 4;
// Persist partial progress this often (in assets located) so closing the app
// mid-build resumes from the last checkpoint instead of restarting from zero.
// Each checkpoint is a synchronous JSON write, so this is a balance: small
// enough to lose little work on a kill, large enough to keep writes infrequent
// (~4 for a 10k library) so they don't hitch the feed during the background build.
const CHECKPOINT_EVERY = 2000;

export type LocatePacing = { concurrency: number; interBatchDelayMs: number };

// Pure: how aggressively to run a sweep of `total` assets. Kept separate (and
// exported) so the pacing decision is unit-testable without touching native reads.
export function locatePacing(total: number): LocatePacing {
  if (total > LARGE_SWEEP_THRESHOLD) {
    return { concurrency: LARGE_SWEEP_CONCURRENCY, interBatchDelayMs: LARGE_SWEEP_DELAY_MS };
  }
  return { concurrency: HYDRATE_CONCURRENCY, interBatchDelayMs: 0 };
}

// --- First-build progress ----------------------------------------------------
// Surfaced to the Near Me "Setting up" note so the one-time full sweep reads as
// working (a live count), not a hung spinner. Plain module pub/sub (no React
// here — this module is also imported by the headless geofence task).
export type BuildProgress = { processed: number; total: number };
let buildProgress: BuildProgress = { processed: 0, total: 0 };
let lastProgressNotified = 0;
const progressSubs = new Set<() => void>();

export function getBuildProgress(): BuildProgress {
  return buildProgress;
}

export function subscribeBuildProgress(cb: () => void): () => void {
  progressSubs.add(cb);
  return () => {
    progressSubs.delete(cb);
  };
}

// Pure: throttle so a 10k sweep emits ~50 updates (every `step`, plus the first
// and last), not thousands — a smooth count without re-render churn.
export function shouldNotifyProgress(
  processed: number,
  total: number,
  lastNotified: number,
  step: number
): boolean {
  return processed === 0 || processed >= total || processed - lastNotified >= step;
}

const PROGRESS_NOTIFY_STEP = 200;
function setBuildProgress(processed: number, total: number): void {
  buildProgress = { processed, total };
  if (shouldNotifyProgress(processed, total, lastProgressNotified, PROGRESS_NOTIFY_STEP)) {
    lastProgressNotified = processed;
    for (const fn of progressSubs) fn();
  }
}

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

export type LocateResult =
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

// Pure: fold a batch of locate results for `processedAssets` onto a kept base
// (the entries carried over from a prior index), producing a complete AssetIndex
// shape. Used both for the running checkpoint and the final result, and exported
// so the assembly is unit-testable.
export function assembleIndex(
  kept: AssetIndex,
  processedAssets: Asset[],
  results: LocateResult[]
): AssetIndex {
  const located = [...kept.located];
  const unlocatedVideos = [...kept.unlocatedVideos];
  const processedIds = [...kept.processedIds];
  results.forEach((r, j) => {
    processedIds.push(processedAssets[j].id);
    if (r.kind === 'located') located.push(r.value);
    else if (r.kind === 'unlocatedVideo') unlocatedVideos.push(r.value);
  });
  return { located, unlocatedVideos, processedIds };
}

export type LocateSweepDeps = {
  locate: (asset: Asset) => Promise<LocateResult>;
  pacing: LocatePacing;
  checkpointEvery: number;
  // Fired after each batch with the accumulated results so far; the caller can
  // persist a partial index. Not fired on the final batch (the caller saves the
  // complete result itself).
  onCheckpoint?: (results: LocateResult[]) => void;
  // Fired after each batch with how many of `assets` are done.
  onProgress?: (processed: number, total: number) => void;
};

// Locate `assets` in paced batches, checkpointing periodically. Dependency-
// injected (locate/pacing/callbacks) so the batching + checkpoint cadence is
// unit-testable without native reads or timers.
export async function runLocateSweep(
  assets: Asset[],
  deps: LocateSweepDeps
): Promise<LocateResult[]> {
  const { locate: locateFn, pacing, checkpointEvery, onCheckpoint, onProgress } = deps;
  const { concurrency, interBatchDelayMs } = pacing;
  const total = assets.length;
  const out: LocateResult[] = [];
  let sinceCheckpoint = 0;
  for (let i = 0; i < assets.length; i += concurrency) {
    const batch = assets.slice(i, i + concurrency);
    const results = await Promise.all(batch.map(locateFn));
    out.push(...results);
    onProgress?.(out.length, total);
    sinceCheckpoint += batch.length;
    // Don't checkpoint the final batch — the caller persists the complete result.
    if (sinceCheckpoint >= checkpointEvery && out.length < total) {
      sinceCheckpoint = 0;
      onCheckpoint?.(out);
    }
    if (interBatchDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, interBatchDelayMs));
    }
  }
  return out;
}

const EMPTY_INDEX: AssetIndex = { located: [], unlocatedVideos: [], processedIds: [] };

// Reconcile the existing index to the current asset list: locate only assets we
// haven't processed before, drop entries for assets that no longer exist, and
// checkpoint partial progress to disk so an interrupted build resumes. Returns
// the same object reference when nothing changed.
async function sync(base: AssetIndex | null, assets: Asset[]): Promise<AssetIndex> {
  const currentIds = new Set(assets.map((a) => a.id));
  const processed = new Set(base?.processedIds ?? []);
  const toAdd = assets.filter((a) => !processed.has(a.id));
  const hasRemovals = base ? base.processedIds.some((id) => !currentIds.has(id)) : false;

  if (base && toAdd.length === 0 && !hasRemovals) return base;

  // Carry over the still-present entries from the prior index (empty on a first
  // build); the sweep appends the newly-located ones onto this.
  const kept: AssetIndex = base
    ? {
        located: base.located.filter((l) => currentIds.has(l.id)),
        unlocatedVideos: base.unlocatedVideos.filter((v) => currentIds.has(v.id)),
        processedIds: base.processedIds.filter((id) => currentIds.has(id)),
      }
    : EMPTY_INDEX;

  if (toAdd.length === 0) {
    // Only removals to apply — no locating needed.
    return { ...kept };
  }

  // Show progress over the WHOLE library (kept + this sweep) so a resume reads
  // "6,200 of 9,800", not a count that restarts. Only when the work is large.
  const libraryTotal = assets.length;
  const baseDone = kept.processedIds.length;
  const report = toAdd.length > LARGE_SWEEP_THRESHOLD;
  if (report) setBuildProgress(baseDone, libraryTotal);

  const results = await runLocateSweep(toAdd, {
    locate,
    pacing: locatePacing(toAdd.length),
    checkpointEvery: CHECKPOINT_EVERY,
    onCheckpoint: (partial) =>
      saveToDisk(assembleIndex(kept, toAdd.slice(0, partial.length), partial)),
    onProgress: report ? (done) => setBuildProgress(baseDone + done, libraryTotal) : undefined,
  });

  if (report) setBuildProgress(libraryTotal, libraryTotal);
  return assembleIndex(kept, toAdd, results);
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
