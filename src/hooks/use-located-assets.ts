import { Asset, MediaType } from 'expo-media-library';

import { loadAssetTimeLocation } from '@/hooks/use-asset-metadata';
import { withTimeoutDefault } from '@/lib/async-safety';
import { isDecodeBurstActive } from '@/lib/decode-burst';
import { LOCATE_READ_MS } from '@/lib/loading-timeouts';
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
// While the Near Me grid is mass-decoding a fresh snapshot (the decode burst),
// the sweep drops to a trickle so metadata reads and image decodes don't peak
// together against the Photos framework — see lib/decode-burst.ts. A burst
// lasts ~10s; the few hundred reads deferred are noise against a full build.
const BURST_SWEEP_CONCURRENCY = 2;
const BURST_SWEEP_DELAY_MS = 150;

export type LocatePacing = { concurrency: number; interBatchDelayMs: number };

// Pure: how aggressively to run a sweep of `total` assets. Kept separate (and
// exported) so the pacing decision is unit-testable without touching native reads.
export function locatePacing(total: number): LocatePacing {
  if (total > LARGE_SWEEP_THRESHOLD) {
    return { concurrency: LARGE_SWEEP_CONCURRENCY, interBatchDelayMs: LARGE_SWEEP_DELAY_MS };
  }
  return { concurrency: HYDRATE_CONCURRENCY, interBatchDelayMs: 0 };
}

// Pure: pacing with the decode-burst state applied.
export function sweepPacing(total: number, decodeBurst: boolean): LocatePacing {
  if (decodeBurst) {
    return { concurrency: BURST_SWEEP_CONCURRENCY, interBatchDelayMs: BURST_SWEEP_DELAY_MS };
  }
  return locatePacing(total);
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

// Per-element validation (pattern: parseRecreation in lib/recreations.ts). The
// index feeds the geofence notifications and Near Me, so a corrupt or
// version-skewed element must be dropped here — downstream cluster math is
// NaN-tolerant and would otherwise silently produce phantom/mislocated
// clusters rather than crash.
const MEDIA_TYPE_VALUES = new Set<string>(Object.values(MediaType));

export function parseLocatedAsset(v: unknown): LocatedAsset | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  if (typeof o.id !== 'string' || o.id.length === 0) return null;
  if (typeof o.lat !== 'number' || !Number.isFinite(o.lat) || o.lat < -90 || o.lat > 90) {
    return null;
  }
  if (typeof o.lng !== 'number' || !Number.isFinite(o.lng) || o.lng < -180 || o.lng > 180) {
    return null;
  }
  const creationTime =
    typeof o.creationTime === 'number' && Number.isFinite(o.creationTime)
      ? o.creationTime
      : o.creationTime === null
        ? null
        : undefined;
  if (creationTime === undefined) return null;
  if (typeof o.mediaType !== 'string' || !MEDIA_TYPE_VALUES.has(o.mediaType)) return null;
  return {
    id: o.id,
    lat: o.lat,
    lng: o.lng,
    creationTime,
    mediaType: o.mediaType as MediaType,
  };
}

export function parseUnlocatedVideo(v: unknown): UnlocatedVideo | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  if (typeof o.id !== 'string' || o.id.length === 0) return null;
  if (typeof o.creationTime !== 'number' || !Number.isFinite(o.creationTime)) return null;
  return { id: o.id, creationTime: o.creationTime };
}

// Best-effort id of a corrupt element, so it can be stripped from processedIds.
function idOf(v: unknown): string | null {
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const id = (v as Record<string, unknown>).id;
    if (typeof id === 'string' && id.length > 0) return id;
  }
  return null;
}

export function parseAssetIndex(text: string | null): AssetIndex | null {
  if (text == null) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const o = parsed as Record<string, unknown>;
    if (
      !Array.isArray(o.located) ||
      !Array.isArray(o.unlocatedVideos) ||
      !Array.isArray(o.processedIds)
    ) {
      return null;
    }
    // Ids of dropped elements are ALSO stripped from processedIds, so the next
    // sync re-locates those assets instead of permanently losing them.
    const droppedIds = new Set<string>();
    const located: LocatedAsset[] = [];
    for (const v of o.located) {
      const entry = parseLocatedAsset(v);
      if (entry) located.push(entry);
      else {
        const id = idOf(v);
        if (id) droppedIds.add(id);
      }
    }
    const unlocatedVideos: UnlocatedVideo[] = [];
    for (const v of o.unlocatedVideos) {
      const entry = parseUnlocatedVideo(v);
      if (entry) unlocatedVideos.push(entry);
      else {
        const id = idOf(v);
        if (id) droppedIds.add(id);
      }
    }
    const processedIds = o.processedIds.filter(
      (id): id is string => typeof id === 'string' && id.length > 0 && !droppedIds.has(id)
    );
    return { located, unlocatedVideos, processedIds };
  } catch {
    return null;
  }
}

async function loadFromDisk(): Promise<AssetIndex | null> {
  try {
    return parseAssetIndex(await readPersisted(INDEX_FILE));
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
  // Bounded so one stuck native read can't stall its whole batch in
  // runLocateSweep — this index feeds the geofence notifications, which must
  // keep making progress. A timed-out asset is simply skipped (kind: 'none')
  // and re-attempted on a later sync.
  return withTimeoutDefault(
    (async (): Promise<LocateResult> => {
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
    })(),
    LOCATE_READ_MS,
    { kind: 'none' }
  );
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
  // A getter is re-read before every batch, so pacing can down-shift mid-sweep
  // (e.g. while a Near Me decode burst is active) without restarting the sweep.
  pacing: LocatePacing | (() => LocatePacing);
  checkpointEvery: number;
  // Fired after each batch with the accumulated results so far; the caller can
  // persist a partial index. Not fired on the final batch (the caller saves the
  // complete result itself).
  onCheckpoint?: (results: LocateResult[]) => void;
  // When it returns false, a due checkpoint is deferred to a later batch — the
  // full-index stringify + synchronous write is the sweep's biggest transient
  // allocation and must stay out of the decode-burst window. `sinceCheckpoint`
  // keeps accumulating, so the save fires on the first allowed batch.
  canCheckpointNow?: () => boolean;
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
  const { locate: locateFn, pacing, checkpointEvery, onCheckpoint, canCheckpointNow, onProgress } =
    deps;
  const total = assets.length;
  const out: LocateResult[] = [];
  let sinceCheckpoint = 0;
  for (let i = 0; i < assets.length; ) {
    const { concurrency, interBatchDelayMs } = typeof pacing === 'function' ? pacing() : pacing;
    const batch = assets.slice(i, i + concurrency);
    i += batch.length;
    const results = await Promise.all(batch.map(locateFn));
    out.push(...results);
    onProgress?.(out.length, total);
    sinceCheckpoint += batch.length;
    // Don't checkpoint the final batch — the caller persists the complete result.
    if (sinceCheckpoint >= checkpointEvery && out.length < total && (canCheckpointNow?.() ?? true)) {
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
    pacing: () => sweepPacing(toAdd.length, isDecodeBurstActive()),
    checkpointEvery: CHECKPOINT_EVERY,
    onCheckpoint: (partial) =>
      saveToDisk(assembleIndex(kept, toAdd.slice(0, partial.length), partial)),
    canCheckpointNow: () => !isDecodeBurstActive(),
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
