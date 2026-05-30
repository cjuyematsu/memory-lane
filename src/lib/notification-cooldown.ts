import { File, Paths } from 'expo-file-system';

const COOLDOWN_FILE = 'notification-cooldown.json';
const COOLDOWN_MS = 6 * 60 * 60 * 1000;

type CooldownMap = Record<string, number>;

function getFile() {
  return new File(Paths.cache, COOLDOWN_FILE);
}

async function load(): Promise<CooldownMap> {
  try {
    const file = getFile();
    if (!file.exists) return {};
    const text = await file.text();
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' ? (parsed as CooldownMap) : {};
  } catch {
    return {};
  }
}

function save(map: CooldownMap): void {
  try {
    const file = getFile();
    if (!file.exists) file.create();
    file.write(JSON.stringify(map));
  } catch {
    // ignore
  }
}

export async function isInCooldown(
  clusterId: string,
  now: number = Date.now()
): Promise<boolean> {
  const map = await load();
  const last = map[clusterId];
  if (last == null) return false;
  return now - last < COOLDOWN_MS;
}

export async function markNotified(
  clusterId: string,
  now: number = Date.now()
): Promise<void> {
  const map = await load();
  map[clusterId] = now;
  save(map);
}
