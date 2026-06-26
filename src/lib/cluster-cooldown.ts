import { persistedFile, readPersisted } from '@/lib/persisted-file';
import { PLACE_COOLDOWN_DEFAULT_MS } from '@/lib/place-cooldown';

// A per-cluster cooldown, keyed by the cluster's stable grid-cell id. Once a
// place has surfaced its memory to you, that memory is "spent" for a while —
// re-notifying about the same spot a day or a week later adds nothing. So after
// a cluster notifies, that specific cluster stays quiet for a window regardless
// of where you are. This is distinct from the location cooldown
// (notification-cooldown.ts): that one is a short spatial quiet zone that stops
// near-duplicate clusters double-pinging in a single arrival; this one is the
// long-term "don't repeat the same memory" guard. Keyed by id (not lat/lng) so
// genuinely different nearby places aren't wrongly silenced — only the one that
// fired. Persisted to disk so it works when the geofence task runs headless.
//
// The window is user-configurable (Settings / onboarding → placeCooldownMs); the
// callers pass it in. It defaults to ~90 days (PLACE_COOLDOWN_DEFAULT_MS) so
// existing callers/tests are unchanged. `windowMs == null` means the user chose
// "Only once": the place stays spent forever and is never re-notified.
const FILE = 'cluster-cooldown.json';

// clusterId -> last-notified epoch ms.
type Store = Record<string, number>;

async function load(): Promise<Store> {
  try {
    const text = await readPersisted(FILE);
    if (text == null) return {};
    const parsed = JSON.parse(text);
    // Only a plain object maps ids to timestamps; tolerate anything else (an
    // array, null, a primitive) by starting fresh.
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Store;
    }
    return {};
  } catch {
    return {};
  }
}

function save(store: Store): void {
  try {
    const f = persistedFile(FILE);
    if (!f.exists) f.create();
    f.write(JSON.stringify(store));
  } catch {
    // ignore
  }
}

export async function isClusterInCooldown(
  clusterId: string,
  now: number = Date.now(),
  windowMs: number | null = PLACE_COOLDOWN_DEFAULT_MS
): Promise<boolean> {
  const at = (await load())[clusterId];
  if (at == null) return false;
  // "Only once": once a place has fired it stays spent indefinitely.
  if (windowMs == null) return true;
  return now - at < windowMs;
}

export async function markClusterNotified(
  clusterId: string,
  now: number = Date.now(),
  windowMs: number | null = PLACE_COOLDOWN_DEFAULT_MS
): Promise<void> {
  const store = await load();
  // Drop expired entries on write so the file doesn't grow without bound. Under
  // "Only once" (windowMs null) nothing ever expires, so skip pruning entirely.
  if (windowMs != null) {
    for (const id of Object.keys(store)) {
      if (now - store[id] >= windowMs) delete store[id];
    }
  }
  store[clusterId] = now;
  save(store);
}
