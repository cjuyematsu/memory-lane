import { persistedFile, readPersisted } from '@/lib/persisted-file';

// A per-cluster cooldown, keyed by the cluster's stable grid-cell id. Once a
// place has surfaced its memory to you, that memory is "spent" for a while —
// re-notifying about the same spot a day or a week later adds nothing. So after
// a cluster notifies, that specific cluster stays quiet for ~90 days regardless
// of where you are. This is distinct from the location cooldown
// (notification-cooldown.ts): that one is a short spatial quiet zone that stops
// near-duplicate clusters double-pinging in a single arrival; this one is the
// long-term "don't repeat the same memory" guard. Keyed by id (not lat/lng) so
// genuinely different nearby places aren't wrongly silenced — only the one that
// fired. Persisted to disk so it works when the geofence task runs headless.
const FILE = 'cluster-cooldown.json';
const WINDOW_MS = 90 * 24 * 60 * 60 * 1000; // ~90 days. Tune here.

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
  now: number = Date.now()
): Promise<boolean> {
  const at = (await load())[clusterId];
  return at != null && now - at < WINDOW_MS;
}

export async function markClusterNotified(
  clusterId: string,
  now: number = Date.now()
): Promise<void> {
  const store = await load();
  // Drop expired entries on write so the file doesn't grow without bound.
  for (const id of Object.keys(store)) {
    if (now - store[id] >= WINDOW_MS) delete store[id];
  }
  store[clusterId] = now;
  save(store);
}
