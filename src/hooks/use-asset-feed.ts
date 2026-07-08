import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';

import { File, Paths } from 'expo-file-system';
import {
  addListener,
  Album,
  Asset,
  AssetField,
  MediaSubtype,
  MediaType,
  Query,
} from 'expo-media-library';

import { withRetry, withTimeout, withTimeoutDefault } from '@/lib/async-safety';
import {
  COLD_START_RETRIES,
  COLD_START_RETRY_BASE_MS,
  LIBRARY_QUERY_MS,
  SCREENSHOT_FILTER_MS,
} from '@/lib/loading-timeouts';

export type FeedState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; assets: Asset[] }
  | { status: 'error'; message: string };

// Ceiling on how much of the library the app sees. The query is newest-first,
// so anything past the cap silently VANISHES from the entire app — shuffle,
// Near Me, the located index, geofence notifications ("beta tester with 32k
// photos only ever saw the last year" was a 10k cap, not a filter). High enough
// to cover essentially all real libraries; kept finite so a pathological
// 200k+ library can't blow the 12s query bound (which would error the whole
// feed) — for those, the newest 60k still work.
const MAX_LIBRARY_ASSETS = 60000;
// If materializing the full cap blows the query bound anyway (huge library on
// a slow device), degrade to the old cap rather than bricking the feed with an
// error screen the 10k builds never showed. Per-reload, not sticky: the next
// reload (library change, retry) attempts the full cap again.
const FALLBACK_LIBRARY_ASSETS = 10000;

const SCREENSHOT_BATCH = 500;
const screenshotCache = new Map<string, boolean>();
let screenshotCacheLoaded = false;
let screenshotCacheDirty = false;

const SCREENSHOT_CACHE_FILE = 'screenshot-cache.json';

function getCacheFile() {
  return new File(Paths.cache, SCREENSHOT_CACHE_FILE);
}

async function loadScreenshotCacheFromDisk(): Promise<void> {
  if (screenshotCacheLoaded) return;
  screenshotCacheLoaded = true;
  try {
    const file = getCacheFile();
    if (!file.exists) return;
    const text = await file.text();
    const parsed = JSON.parse(text) as Record<string, boolean>;
    for (const [id, v] of Object.entries(parsed)) {
      screenshotCache.set(id, v);
    }
  } catch {
    // ignore corrupt cache
  }
}

async function persistScreenshotCache(): Promise<void> {
  if (!screenshotCacheDirty) return;
  screenshotCacheDirty = false;
  try {
    const obj: Record<string, boolean> = {};
    for (const [id, v] of screenshotCache) obj[id] = v;
    const file = getCacheFile();
    if (!file.exists) file.create();
    file.write(JSON.stringify(obj));
  } catch {
    // ignore write failure
  }
}

async function rejectScreenshotsIOS(assets: Asset[]): Promise<Asset[]> {
  await loadScreenshotCacheFromDisk();
  // Only fetch subtypes for assets we haven't seen before.
  const toCheck = assets.filter((a) => !screenshotCache.has(a.id));
  for (let i = 0; i < toCheck.length; i += SCREENSHOT_BATCH) {
    const slice = toCheck.slice(i, i + SCREENSHOT_BATCH);
    await Promise.all(
      slice.map(async (a) => {
        try {
          const subtypes = await a.getMediaSubtypes();
          screenshotCache.set(a.id, subtypes.includes(MediaSubtype.SCREENSHOT));
        } catch {
          screenshotCache.set(a.id, false);
        }
        screenshotCacheDirty = true;
      })
    );
  }
  if (screenshotCacheDirty) persistScreenshotCache();
  return assets.filter((a) => !screenshotCache.get(a.id));
}

async function rejectScreenshotsAndroid(assets: Asset[]): Promise<Asset[]> {
  try {
    const album = await Album.get('Screenshots');
    if (!album) return assets;
    const shots = await album.getAssets();
    const blocked = new Set(shots.map((a) => a.id));
    return assets.filter((a) => !blocked.has(a.id));
  } catch {
    return assets;
  }
}

async function rejectScreenshots(assets: Asset[]): Promise<Asset[]> {
  if (Platform.OS === 'ios') return rejectScreenshotsIOS(assets);
  if (Platform.OS === 'android') return rejectScreenshotsAndroid(assets);
  return assets;
}

// Module-level cache so re-mounts of useAssetFeed are instant within a session.
let cachedAssets: Asset[] | null = null;
let inflightReload: Promise<Asset[]> | null = null;
const subscribers = new Set<(assets: Asset[]) => void>();

// True when two reloads produced the same library, by ordered asset id. The
// MediaLibrary change listener fires on plenty of events that don't change what
// we render (iCloud sync ticks, edits elsewhere); if the id-sequence is
// identical we keep the existing array reference instead of publishing a new
// one, so nothing downstream (the located index, computeNearby, the grid)
// re-runs or repaints. This is the first line of defense against the Near Me
// flicker.
export function sameAssetIds(a: Asset[], b: Asset[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i].id !== b[i].id) return false;
  }
  return true;
}

function publishAssets(assets: Asset[]) {
  cachedAssets = assets;
  for (const fn of subscribers) fn(assets);
}

function queryLibrary(limit: number): Promise<Asset[]> {
  return new Query()
    .within(AssetField.MEDIA_TYPE, [MediaType.IMAGE, MediaType.VIDEO])
    .orderBy({ key: AssetField.CREATION_TIME, ascending: false })
    .limit(limit)
    .exe();
}

async function runReload(): Promise<Asset[]> {
  if (inflightReload) return inflightReload;
  inflightReload = (async () => {
    try {
      // Bound the native query: MediaLibrary's exe() has no timeout, so on a
      // cold/stalled Photos framework an unbounded await would pin the feed on
      // the loading Polaroid forever. A timeout throws → the smaller fallback
      // query gets one shot → only if that also fails does the caller's
      // retry/error path take over (the inflight latch clears in finally).
      let raw: Asset[];
      try {
        raw = await withTimeout(
          queryLibrary(MAX_LIBRARY_ASSETS),
          LIBRARY_QUERY_MS,
          'library query'
        );
      } catch {
        raw = await withTimeout(
          queryLibrary(FALLBACK_LIBRARY_ASSETS),
          LIBRARY_QUERY_MS,
          'library query (fallback cap)'
        );
      }
      // Screenshot filtering reads per-asset native subtypes; if it stalls,
      // degrade to the unfiltered list (show everything, maybe a few
      // screenshots) rather than blocking the whole feed.
      const filtered = await withTimeoutDefault(rejectScreenshots(raw), SCREENSHOT_FILTER_MS, raw);
      // Library unchanged since last reload → keep the stable reference and
      // publish nothing, so a spurious change event can't churn the feed.
      if (cachedAssets && sameAssetIds(cachedAssets, filtered)) {
        return cachedAssets;
      }
      publishAssets(filtered);
      return filtered;
    } finally {
      inflightReload = null;
    }
  })();
  return inflightReload;
}

// Imperative one-shot loader for non-React callers (e.g. the onboarding
// prewarm): loads the asset list once, deduped through the same module
// inflight/cached path the hook uses, without mounting a hook. Resolves to the
// loaded library.
export function ensureAssetsLoaded(): Promise<Asset[]> {
  return runReload();
}

export function useAssetFeed(enabled: boolean) {
  const [state, setState] = useState<FeedState>(() =>
    cachedAssets
      ? { status: 'ready', assets: cachedAssets }
      : { status: 'idle' }
  );
  const reqId = useRef(0);

  const reload = useCallback(async (silent = false) => {
    const myId = ++reqId.current;
    if (!silent && !cachedAssets) setState({ status: 'loading' });
    try {
      await runReload();
    } catch (e) {
      if (reqId.current !== myId) return;
      if (silent) return;
      setState({ status: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  }, []);

  useEffect(() => {
    const fn = (assets: Asset[]) => setState({ status: 'ready', assets });
    subscribers.add(fn);
    return () => {
      subscribers.delete(fn);
    };
  }, []);

  // Initial kickoff goes straight to the module loader: the 'idle' status
  // already renders as a spinner everywhere, so no synchronous 'loading'
  // transition is needed (results/errors land via async callbacks).
  useEffect(() => {
    if (!enabled || state.status !== 'idle') return;
    let stale = false;
    // Silent bounded auto-retry: a transient cold-launch stall (Photos framework
    // not warm) recovers on its own; only a persistent failure surfaces the
    // error/Retry screen. Each attempt is a fresh runReload (the inflight latch
    // self-clears in finally), so a retry never re-awaits a rejected promise.
    withRetry(() => runReload(), COLD_START_RETRIES, COLD_START_RETRY_BASE_MS).catch((e) => {
      if (stale) return;
      setState({
        status: 'error',
        message: e instanceof Error ? e.message : String(e),
      });
    });
    return () => {
      stale = true;
    };
  }, [enabled, state.status]);

  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const sub = addListener(() => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        reload(true);
      }, 300);
    });
    return () => {
      if (timer) clearTimeout(timer);
      sub.remove();
    };
  }, [enabled, reload]);

  return { state, reload };
}
