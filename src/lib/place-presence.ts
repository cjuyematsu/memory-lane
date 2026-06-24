import { persistedFile, readPersisted } from '@/lib/persisted-file';
import { distanceMeters } from '@/utils/distance';

// Home and work are the places you keep physically returning to — NOT the places
// you photograph (you might never shoot a photo at the office). So we log a light
// presence ping each time you're detected somewhere (a geofence enter, or an app
// open) and treat a spot as "routine" — home / work / gym — once you've been
// there on enough DISTINCT days inside a rolling window. Routine places never
// notify or greet; when you stop coming (move out, change jobs) the window
// empties and the place becomes a surfaceable memory again. Headless-safe: reads
// and writes only disk, so it works when the geofence task runs app-killed.
const FILE_NAME = 'place-presence.json';
const DAY_MS = 24 * 60 * 60 * 1000;
// Rolling window: only presence within this many days counts, so the signal
// tracks your current life and forgets places you've left.
const WINDOW_DAYS = 14;
// A "home zone" is bigger than a ~50m photo cell — home spans a few cells, you
// park down the block, GPS drifts — so presence within this radius is one place.
const ROUTINE_RADIUS_M = 150;
// Present on at least this many distinct days in the window → routine. Home/work
// (near-daily) crosses it in a few days; a once-a-week spot stays notifiable.
export const ROUTINE_DAY_THRESHOLD = 3;

type PresenceEntry = { lat: number; lng: number; day: number };

async function load(): Promise<PresenceEntry[]> {
  try {
    const text = await readPersisted(FILE_NAME);
    if (text == null) return [];
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? (parsed as PresenceEntry[]) : [];
  } catch {
    return [];
  }
}

function save(entries: PresenceEntry[]): void {
  try {
    const f = persistedFile(FILE_NAME);
    if (!f.exists) f.create();
    f.write(JSON.stringify(entries));
  } catch {
    // ignore
  }
}

// Log that the user was at (lat,lng) now — at most one entry per place per day.
// Prunes anything outside the rolling window so the file stays small.
export async function recordPresence(
  lat: number,
  lng: number,
  now: number = Date.now()
): Promise<void> {
  const day = Math.floor(now / DAY_MS);
  const minDay = day - WINDOW_DAYS;
  const here = { latitude: lat, longitude: lng };
  const entries = (await load()).filter((e) => e.day >= minDay);
  const loggedHereToday = entries.some(
    (e) =>
      e.day === day &&
      distanceMeters(here, { latitude: e.lat, longitude: e.lng }) <= ROUTINE_RADIUS_M
  );
  if (!loggedHereToday) entries.push({ lat, lng, day });
  save(entries);
}

// Distinct days within the rolling window that the user was near (lat,lng).
export async function routineDayCount(
  lat: number,
  lng: number,
  now: number = Date.now()
): Promise<number> {
  const minDay = Math.floor(now / DAY_MS) - WINDOW_DAYS;
  const here = { latitude: lat, longitude: lng };
  const days = new Set<number>();
  for (const e of await load()) {
    if (
      e.day >= minDay &&
      distanceMeters(here, { latitude: e.lat, longitude: e.lng }) <= ROUTINE_RADIUS_M
    ) {
      days.add(e.day);
    }
  }
  return days.size;
}

// A routine place (home / work / etc.) — suppress notifications and greetings.
export async function isRoutineLocation(
  lat: number,
  lng: number,
  now: number = Date.now()
): Promise<boolean> {
  return (await routineDayCount(lat, lng, now)) >= ROUTINE_DAY_THRESHOLD;
}
