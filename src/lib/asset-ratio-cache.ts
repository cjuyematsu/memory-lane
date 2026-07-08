import { persistedFile, readPersisted } from '@/lib/persisted-file';

// Shared cache of each asset's intrinsic aspect ratio (width / height), keyed by
// asset id. The Near Me grid decodes every tile's poster via expo-image anyway,
// whose onLoad reports the source's intrinsic dimensions regardless of
// contentFit — so the grid records the ratio here for free as tiles load. The
// viewer then SEEDS its frame from this cache on open, so a video (or photo)
// opens already at its true shape instead of defaulting to 3:4 and resizing a
// beat later (the "zoom out" snap). Since you must see a tile to tap it, the
// poster is essentially always loaded by tap time, so the cache hits. The feed
// card seeds its contain/cover fit from it the same way.
//
// Ratios never change for an asset, so there's no invalidation. FIFO-capped so a
// huge library can't grow it unbounded (mirrors `cappedSet` in
// hooks/use-asset-metadata.ts).
//
// PERSISTED across launches (hydrateAssetRatios at boot + throttled writes on
// set): a landscape photo the user has ever seen opens in the right fit on every
// later launch, instead of re-flashing the cover→contain correction once per
// session. Reads stay non-reactive by design — a card seeds from the cache at
// render and falls back to its own onLoad, so hydration finishing after a first
// render self-corrects the same way a cold cache does (see the CLAUDE.md note on
// module caches in render).
const MAX_RATIO_ENTRIES = 3000;
const FILE = 'asset-ratios.json';
// Throttle (not debounce): a scroll burst writes at most once per window instead
// of pushing the save out indefinitely.
const SAVE_THROTTLE_MS = 3000;

const cache = new Map<string, number>();

export function getAssetRatio(id: string): number | undefined {
  return cache.get(id);
}

function insert(id: string, ratio: number): boolean {
  if (!Number.isFinite(ratio) || ratio <= 0) return false;
  if (!cache.has(id) && cache.size >= MAX_RATIO_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(id, ratio);
  return true;
}

export function setAssetRatio(id: string, ratio: number): void {
  if (insert(id, ratio)) scheduleSave();
}

// Pure (unit tested): newest `cap` entries as a plain JSON object. Map preserves
// insertion order, so the tail is the most recently recorded.
export function serializeRatios(
  map: ReadonlyMap<string, number>,
  cap: number = MAX_RATIO_ENTRIES
): string {
  return JSON.stringify(Object.fromEntries([...map].slice(-cap)));
}

// Pure (unit tested): junk-tolerant parse — anything that isn't a plain object
// of positive finite numbers is dropped (a corrupt file must never poison the
// cache or throw), capped so a tampered file can't balloon memory.
export function parseRatios(
  text: string,
  cap: number = MAX_RATIO_ENTRIES
): [string, number][] {
  try {
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return [];
    const out: [string, number][] = [];
    for (const [id, ratio] of Object.entries(parsed)) {
      if (typeof ratio !== 'number' || !Number.isFinite(ratio) || ratio <= 0) continue;
      out.push([id, ratio]);
      if (out.length >= cap) break;
    }
    return out;
  } catch {
    return [];
  }
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleSave(): void {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      const f = persistedFile(FILE);
      if (!f.exists) f.create();
      f.write(serializeRatios(cache));
    } catch {
      // best-effort; the in-session cache still works and the next set retries
    }
  }, SAVE_THROTTLE_MS);
  // Under Node (jest) a pending throttle would hold the process open past the
  // test run; unref exists there and is a no-op concern on React Native, where
  // setTimeout returns a number without it.
  (saveTimer as { unref?: () => void }).unref?.();
}

// Merge persisted entries UNDER whatever this session already recorded
// (exported for tests). Order matters twice — insert() evicts from the Map's
// head at the cap, and serializeRatios keeps the tail — so session entries are
// re-appended last: they stay the freshest (their values win over a persisted
// duplicate, and a full-cap hydration evicts stale disk entries, never them).
export function applyHydratedRatios(entries: readonly [string, number][]): void {
  const session = [...cache];
  cache.clear();
  for (const [id, ratio] of entries) insert(id, ratio);
  for (const [id, ratio] of session) {
    cache.delete(id); // re-position at the tail, not the persisted slot
    insert(id, ratio);
  }
}

// Load the persisted ratios once at boot (fire-and-forget from _layout).
// Session values win: an id recorded this launch is fresher than the file.
let hydrateStarted = false;
export async function hydrateAssetRatios(): Promise<void> {
  if (hydrateStarted) return;
  hydrateStarted = true;
  try {
    const text = await readPersisted(FILE);
    if (text == null) return;
    applyHydratedRatios(parseRatios(text));
  } catch {
    // best-effort; a cold cache just means the old self-correcting behavior
  }
}
