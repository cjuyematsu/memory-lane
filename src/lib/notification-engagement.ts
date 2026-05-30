import { File, Paths } from 'expo-file-system';

const FILE_NAME = 'notification-engagement.json';
// Surfacing a cluster this many times without the user ever tapping through
// marks it as "ignored" and suppresses it for a while.
const SURFACE_LIMIT = 3;
const SUPPRESS_MS = 30 * 24 * 60 * 60 * 1000;

type EngagementEntry = {
  surfaced: number;
  suppressedUntil: number | null;
};

type EngagementMap = Record<string, EngagementEntry>;

function getFile() {
  return new File(Paths.cache, FILE_NAME);
}

async function load(): Promise<EngagementMap> {
  try {
    const file = getFile();
    if (!file.exists) return {};
    const text = await file.text();
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' ? (parsed as EngagementMap) : {};
  } catch {
    return {};
  }
}

function save(map: EngagementMap): void {
  try {
    const file = getFile();
    if (!file.exists) file.create();
    file.write(JSON.stringify(map));
  } catch {
    // ignore
  }
}

export async function isSuppressed(
  clusterId: string,
  now: number = Date.now()
): Promise<boolean> {
  const map = await load();
  const entry = map[clusterId];
  if (!entry || entry.suppressedUntil == null) return false;
  return now < entry.suppressedUntil;
}

// Called when a cluster is surfaced (banner or notification). After enough
// un-engaged surfaces it flips into a suppression window.
export async function recordSurfaced(
  clusterId: string,
  now: number = Date.now()
): Promise<void> {
  const map = await load();
  const entry = map[clusterId] ?? { surfaced: 0, suppressedUntil: null };
  entry.surfaced += 1;
  if (entry.surfaced >= SURFACE_LIMIT) {
    entry.suppressedUntil = now + SUPPRESS_MS;
    entry.surfaced = 0;
  }
  map[clusterId] = entry;
  save(map);
}

// Called when the user taps through to a cluster — clears the ignore count
// and any active suppression so the place can surface freely again.
export async function recordEngaged(clusterId: string): Promise<void> {
  const map = await load();
  map[clusterId] = { surfaced: 0, suppressedUntil: null };
  save(map);
}
