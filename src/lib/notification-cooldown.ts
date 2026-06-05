import { distanceMeters } from '@/hooks/use-photo-clusters';
import { persistedFile, readPersisted } from '@/lib/persisted-file';

const COOLDOWN_FILE = 'notification-cooldown.json';
const COOLDOWN_MS = 6 * 60 * 60 * 1000;
// After notifying about a place, stay quiet within this radius of it for the
// cooldown window. Large enough to avoid re-pinging the same spot (and its
// adjacent ~50m clusters), small enough that distinct places — e.g. different
// buildings on a campus — still each get their own notification. Tune here.
const COOLDOWN_RADIUS_M = 150;

type CooldownEntry = { lat: number; lng: number; at: number };

async function load(): Promise<CooldownEntry[]> {
  try {
    const text = await readPersisted(COOLDOWN_FILE);
    if (text == null) return [];
    const parsed = JSON.parse(text);
    // Tolerate the previous per-cluster map format by ignoring it.
    return Array.isArray(parsed) ? (parsed as CooldownEntry[]) : [];
  } catch {
    return [];
  }
}

function save(entries: CooldownEntry[]): void {
  try {
    const file = persistedFile(COOLDOWN_FILE);
    if (!file.exists) file.create();
    file.write(JSON.stringify(entries));
  } catch {
    // ignore
  }
}

// True if we notified about somewhere within COOLDOWN_RADIUS_M of this point
// inside the cooldown window — so the same place won't spam, but a place
// farther than the radius (a different spot on campus) still can.
export async function isInCooldown(
  lat: number,
  lng: number,
  now: number = Date.now()
): Promise<boolean> {
  const entries = await load();
  return entries.some(
    (e) =>
      now - e.at < COOLDOWN_MS &&
      distanceMeters(lat, lng, e.lat, e.lng) <= COOLDOWN_RADIUS_M
  );
}

export async function markNotified(
  lat: number,
  lng: number,
  now: number = Date.now()
): Promise<void> {
  // Drop expired entries so the file doesn't grow without bound.
  const entries = (await load()).filter((e) => now - e.at < COOLDOWN_MS);
  entries.push({ lat, lng, at: now });
  save(entries);
}
