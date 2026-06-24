import { distanceMeters } from '@/hooks/use-photo-clusters';
import { persistedFile, readPersisted } from '@/lib/persisted-file';

type CooldownEntry = { lat: number; lng: number; at: number };

export type LocationCooldownOptions = {
  // File name under the document directory holding the entries.
  file: string;
  // How long after notifying about a place we stay quiet near it.
  windowMs: number;
  // After notifying, stay quiet within this radius (meters) of that point. Large
  // enough to avoid re-pinging the same spot, small enough that distinct places
  // (e.g. different buildings) still each get notified.
  radiusM: number;
};

export type LocationCooldown = {
  // radiusOverride lets a caller widen/tighten the quiet zone per place (e.g. to
  // track local photo density); falls back to the factory's radiusM.
  isInCooldown: (
    lat: number,
    lng: number,
    now?: number,
    radiusOverride?: number
  ) => Promise<boolean>;
  markNotified: (lat: number, lng: number, now?: number) => Promise<void>;
};

// A location-keyed cooldown persisted to disk. Used both for the geofence
// notifications (6h) and the "memories near you" app-open banner (24h); each gets
// its own file so they never interfere. Behavior: "in cooldown" if we notified
// about somewhere within `radiusM` of this point inside the `windowMs` window —
// so the same place won't spam, but a place farther than the radius still can.
export function createLocationCooldown({
  file,
  windowMs,
  radiusM,
}: LocationCooldownOptions): LocationCooldown {
  async function load(): Promise<CooldownEntry[]> {
    try {
      const text = await readPersisted(file);
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
      const f = persistedFile(file);
      if (!f.exists) f.create();
      f.write(JSON.stringify(entries));
    } catch {
      // ignore
    }
  }

  async function isInCooldown(
    lat: number,
    lng: number,
    now: number = Date.now(),
    radiusOverride?: number
  ): Promise<boolean> {
    const radius = radiusOverride ?? radiusM;
    const entries = await load();
    return entries.some(
      (e) =>
        now - e.at < windowMs && distanceMeters(lat, lng, e.lat, e.lng) <= radius
    );
  }

  async function markNotified(
    lat: number,
    lng: number,
    now: number = Date.now()
  ): Promise<void> {
    // Drop expired entries so the file doesn't grow without bound.
    const entries = (await load()).filter((e) => now - e.at < windowMs);
    entries.push({ lat, lng, at: now });
    save(entries);
  }

  return { isInCooldown, markNotified };
}
