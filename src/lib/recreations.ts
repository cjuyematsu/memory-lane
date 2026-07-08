import { useEffect, useState } from 'react';

import { Directory, File, Paths } from 'expo-file-system';

import { persistedFile, readPersisted } from '@/lib/persisted-file';

// Kept recreations (then/now photo pairs). Nothing is saved automatically:
// a pair only lands here when the user explicitly taps Save on the review
// screen. The retaken photo is copied out of the camera's tmp cache into a
// `recreations/` directory under the document dir (cache is purged under
// storage pressure; document is not), and the pair metadata lives in
// recreations.json alongside it, following the module-cache + pub/sub +
// persisted-file pattern of use-notification-settings.ts.

const FILE_NAME = 'recreations.json';
const DIR_NAME = 'recreations';
const STORE_VERSION = 1;

export type RecreationLocation = { latitude: number; longitude: number };

export type Recreation = {
  id: string;
  // The original photo's library id (ph:// / content://). Render-only: the
  // user may delete the original later, so consumers must survive a failed
  // load (the gallery degrades the "then" panel instead of crashing).
  oldAssetId: string;
  // FILENAME within the recreations dir, never an absolute URI — the iOS app
  // container UUID (and thus every file:// path) changes across app updates.
  // Resolve with recreationUri().
  newPhotoFile: string;
  capturedAt: number;
  // Caption inputs, persisted so re-sharing works after metadata caches are
  // cold and even after the original asset is gone.
  oldCreationTime: number | null;
  oldLocation: RecreationLocation | null;
  // Which photo fills the BeReal-style composite (the other is the corner
  // inset) — the arrangement showing when the user hit Save.
  primary: 'then' | 'now';
  // How far from the original spot the retake was captured, when known.
  capturedDistanceM: number | null;
};

type Store = { version: number; items: Recreation[] };

// ── Pure serialization (unit-tested) ─────────────────────────────────────────

function isValidLocation(v: unknown): v is RecreationLocation {
  if (typeof v !== 'object' || v == null) return false;
  const loc = v as Record<string, unknown>;
  return typeof loc.latitude === 'number' && typeof loc.longitude === 'number';
}

function parseRecreation(v: unknown): Recreation | null {
  if (typeof v !== 'object' || v == null) return null;
  const r = v as Record<string, unknown>;
  if (typeof r.id !== 'string' || r.id.length === 0) return null;
  if (typeof r.oldAssetId !== 'string' || r.oldAssetId.length === 0) return null;
  if (typeof r.newPhotoFile !== 'string' || r.newPhotoFile.length === 0) return null;
  if (typeof r.capturedAt !== 'number' || !Number.isFinite(r.capturedAt)) return null;
  return {
    id: r.id,
    oldAssetId: r.oldAssetId,
    newPhotoFile: r.newPhotoFile,
    capturedAt: r.capturedAt,
    oldCreationTime:
      typeof r.oldCreationTime === 'number' && Number.isFinite(r.oldCreationTime)
        ? r.oldCreationTime
        : null,
    oldLocation: isValidLocation(r.oldLocation) ? r.oldLocation : null,
    // Additive fields (older rows lack them): default to the retake as the
    // hero, and no recorded distance.
    primary: r.primary === 'then' ? 'then' : 'now',
    capturedDistanceM:
      typeof r.capturedDistanceM === 'number' &&
      Number.isFinite(r.capturedDistanceM) &&
      r.capturedDistanceM >= 0
        ? r.capturedDistanceM
        : null,
  };
}

// Tolerant parse: malformed entries are dropped individually; anything that
// isn't a version-1 store (corrupt JSON, wrong shape, future version) starts
// fresh rather than throwing.
export function parseRecreations(text: string | null): Recreation[] {
  if (text == null) return [];
  try {
    const parsed = JSON.parse(text) as unknown;
    if (typeof parsed !== 'object' || parsed == null) return [];
    const store = parsed as Partial<Store>;
    if (store.version !== STORE_VERSION || !Array.isArray(store.items)) return [];
    const items: Recreation[] = [];
    for (const item of store.items) {
      const rec = parseRecreation(item);
      if (rec) items.push(rec);
    }
    return items;
  } catch {
    return [];
  }
}

export function serializeRecreations(items: Recreation[]): string {
  return JSON.stringify({ version: STORE_VERSION, items } satisfies Store);
}

// ── Files ────────────────────────────────────────────────────────────────────

function recreationsDir(): Directory {
  const dir = new Directory(Paths.document, DIR_NAME);
  if (!dir.exists) dir.create({ idempotent: true });
  return dir;
}

export function recreationUri(r: Recreation): string {
  return new File(Paths.document, DIR_NAME, r.newPhotoFile).uri;
}

// ── Module cache + pub/sub ───────────────────────────────────────────────────

let cached: Recreation[] | null = null;
let inflight: Promise<Recreation[]> | null = null;
const subscribers = new Set<(items: Recreation[]) => void>();

function notify() {
  if (!cached) return;
  for (const cb of subscribers) cb(cached);
}

function loadFromDisk(): Promise<Recreation[]> {
  if (cached) return Promise.resolve(cached);
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const text = await readPersisted(FILE_NAME);
      cached = parseRecreations(text);
      return cached;
    } catch {
      cached = [];
      return cached;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

function saveToDisk(items: Recreation[]): void {
  try {
    const file = persistedFile(FILE_NAME);
    if (!file.exists) file.create();
    file.write(serializeRecreations(items));
  } catch {
    // ignore write failure; in-memory state is still authoritative
  }
}

const extensionOf = (uri: string): string => {
  const base = uri.split(/[?#]/)[0].split('/').pop() ?? '';
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : 'jpg';
};

export type AddRecreationInput = {
  oldAssetId: string;
  // The capture's tmp file (camera cache). Copied, not moved, so the review
  // screen can still share off the tmp uri after a Save.
  tmpPhotoUri: string;
  capturedAt: number;
  oldCreationTime: number | null;
  oldLocation: RecreationLocation | null;
  primary: 'then' | 'now';
  capturedDistanceM: number | null;
};

// Copy the jpg into durable storage FIRST, then write the JSON row: a crash
// between the two leaves a harmless orphan file, never a row pointing at
// nothing. Throws if the copy fails (caller surfaces the error).
export async function addRecreation(input: AddRecreationInput): Promise<Recreation> {
  const items = await loadFromDisk();
  const id = `rc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const newPhotoFile = `${id}.${extensionOf(input.tmpPhotoUri)}`;
  const dest = new File(recreationsDir(), newPhotoFile);
  await new File(input.tmpPhotoUri).copy(dest);
  const rec: Recreation = {
    id,
    oldAssetId: input.oldAssetId,
    newPhotoFile,
    capturedAt: input.capturedAt,
    oldCreationTime: input.oldCreationTime,
    oldLocation: input.oldLocation,
    primary: input.primary,
    capturedDistanceM: input.capturedDistanceM,
  };
  // Newest first — the gallery renders in this order.
  cached = [rec, ...items];
  notify();
  saveToDisk(cached);
  return rec;
}

export async function removeRecreation(id: string): Promise<void> {
  const items = await loadFromDisk();
  const rec = items.find((r) => r.id === id);
  if (!rec) return;
  cached = items.filter((r) => r.id !== id);
  notify();
  saveToDisk(cached);
  // Best-effort file cleanup after the row is gone — an orphan jpg is
  // harmless, a row without its jpg is not.
  try {
    const file = new File(Paths.document, DIR_NAME, rec.newPhotoFile);
    if (file.exists) file.delete();
  } catch {
    // ignore
  }
}

// null = not loaded from disk yet (distinct from a loaded-but-empty list, so
// the gallery can hold its empty state until the read settles).
export function useRecreations(): Recreation[] | null {
  const [items, setItems] = useState<Recreation[] | null>(cached);
  useEffect(() => {
    let cancelled = false;
    loadFromDisk().then((value) => {
      if (!cancelled) setItems(value);
    });
    const subscriber = (value: Recreation[]) => setItems(value);
    subscribers.add(subscriber);
    return () => {
      cancelled = true;
      subscribers.delete(subscriber);
    };
  }, []);
  return items;
}
