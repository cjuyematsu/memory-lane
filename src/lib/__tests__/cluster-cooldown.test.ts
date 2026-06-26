import { isClusterInCooldown, markClusterNotified } from '@/lib/cluster-cooldown';

const mockStore = new Map<string, string>();

jest.mock('@/lib/persisted-file', () => ({
  persistedFile: (name: string) => ({
    get exists() {
      return mockStore.has(name);
    },
    create: () => {
      if (!mockStore.has(name)) mockStore.set(name, '');
    },
    write: (text: string) => {
      mockStore.set(name, text);
    },
  }),
  readPersisted: async (name: string) => mockStore.get(name) ?? null,
}));

const FILE = 'cluster-cooldown.json';
const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_800_000_000_000;
const ID_A = '68000,-234000';
const ID_B = '68001,-234000';

beforeEach(() => {
  mockStore.clear();
});

describe('cluster cooldown', () => {
  it('is not in cooldown with no history', async () => {
    expect(await isClusterInCooldown(ID_A, NOW)).toBe(false);
  });

  it('is in cooldown right after the cluster notifies', async () => {
    await markClusterNotified(ID_A, NOW);
    expect(await isClusterInCooldown(ID_A, NOW + DAY)).toBe(true);
  });

  it('is independent per cluster id', async () => {
    await markClusterNotified(ID_A, NOW);
    // A is quiet, but a genuinely different place (different id) still fires —
    // even if it is physically close, since this cooldown is keyed by id.
    expect(await isClusterInCooldown(ID_A, NOW + DAY)).toBe(true);
    expect(await isClusterInCooldown(ID_B, NOW + DAY)).toBe(false);
  });

  it('expires at the 90-day boundary', async () => {
    await markClusterNotified(ID_A, NOW);
    expect(await isClusterInCooldown(ID_A, NOW + 90 * DAY - 1)).toBe(true);
    expect(await isClusterInCooldown(ID_A, NOW + 90 * DAY)).toBe(false);
  });

  it('refreshes the window when the cluster notifies again', async () => {
    await markClusterNotified(ID_A, NOW);
    await markClusterNotified(ID_A, NOW + 30 * DAY);
    // 100 days after the FIRST ping, but only 70 after the second → still quiet.
    expect(await isClusterInCooldown(ID_A, NOW + 100 * DAY)).toBe(true);
  });

  it('prunes expired entries on write', async () => {
    await markClusterNotified(ID_A, NOW);
    await markClusterNotified(ID_B, NOW + 91 * DAY); // A is now expired
    const store = JSON.parse(mockStore.get(FILE)!);
    expect(Object.keys(store)).toEqual([ID_B]);
  });

  it('honors a custom (shorter) window passed in', async () => {
    await markClusterNotified(ID_A, NOW, 7 * DAY);
    expect(await isClusterInCooldown(ID_A, NOW + 7 * DAY - 1, 7 * DAY)).toBe(true);
    expect(await isClusterInCooldown(ID_A, NOW + 7 * DAY, 7 * DAY)).toBe(false);
  });

  it('silences indefinitely when the window is null ("Only once")', async () => {
    await markClusterNotified(ID_A, NOW, null);
    // Still spent a decade later — once it has fired it never re-notifies.
    expect(await isClusterInCooldown(ID_A, NOW + 10 * 365 * DAY, null)).toBe(true);
    // A place that never fired is not silenced.
    expect(await isClusterInCooldown(ID_B, NOW, null)).toBe(false);
  });

  it('does not prune entries while the window is null', async () => {
    await markClusterNotified(ID_A, NOW, null);
    await markClusterNotified(ID_B, NOW + 1000 * DAY, null);
    const store = JSON.parse(mockStore.get(FILE)!);
    expect(Object.keys(store).sort()).toEqual([ID_A, ID_B].sort());
  });

  it('re-arms a place when switching off "Only once" to a finite window', async () => {
    // Fired once while set to "Only once" (null): records only a timestamp, not
    // a permanent lock. Stays silenced forever *while* the setting is "Only once".
    await markClusterNotified(ID_A, NOW, null);
    expect(await isClusterInCooldown(ID_A, NOW + 365 * DAY, null)).toBe(true);
    // User changes the setting to "1 day". That same timestamp is now read
    // against the 1-day window, so the next visit a day later re-notifies —
    // the global policy applies retroactively, it isn't a sticky per-place flag.
    expect(await isClusterInCooldown(ID_A, NOW + DAY - 1, DAY)).toBe(true); // <1 day: still quiet
    expect(await isClusterInCooldown(ID_A, NOW + DAY, DAY)).toBe(false); // ≥1 day: fires again
  });

  it('tolerates the legacy array (location-cooldown) format', async () => {
    mockStore.set(FILE, JSON.stringify([{ lat: 34, lng: -117, at: NOW }]));
    expect(await isClusterInCooldown(ID_A, NOW)).toBe(false);
  });

  it('tolerates corrupt JSON', async () => {
    mockStore.set(FILE, 'not json{{');
    expect(await isClusterInCooldown(ID_A, NOW)).toBe(false);
    await expect(markClusterNotified(ID_A, NOW)).resolves.toBeUndefined();
  });
});
