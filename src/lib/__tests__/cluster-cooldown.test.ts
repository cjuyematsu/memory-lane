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
