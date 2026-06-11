import { isInCooldown, markNotified } from '@/lib/notification-cooldown';

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

// distanceMeters comes from use-photo-clusters, which pulls in the located
// index; stub the index module so no expo-media-library code loads.
jest.mock('@/hooks/use-located-assets', () => ({
  ensureIndex: jest.fn(),
  getIndex: jest.fn(() => null),
  invalidateIndex: jest.fn(),
  loadIndexFromDisk: jest.fn(async () => null),
}));

const FILE = 'notification-cooldown.json';
const HOUR = 60 * 60 * 1000;
const NOW = 1_800_000_000_000;
const LAT = 34.0;
const LNG = -117.0;
// ~0.0009° latitude ≈ 100m
const DEG_100M = 0.0009;

beforeEach(() => {
  mockStore.clear();
});

describe('notification cooldown', () => {
  it('is not in cooldown with no history', async () => {
    expect(await isInCooldown(LAT, LNG, NOW)).toBe(false);
  });

  it('is in cooldown at the notified point and within 150m', async () => {
    await markNotified(LAT, LNG, NOW);
    expect(await isInCooldown(LAT, LNG, NOW + HOUR)).toBe(true);
    expect(await isInCooldown(LAT + DEG_100M, LNG, NOW + HOUR)).toBe(true);
  });

  it('is not in cooldown beyond the 150m radius', async () => {
    await markNotified(LAT, LNG, NOW);
    // ~200m north
    expect(await isInCooldown(LAT + 2 * DEG_100M, LNG, NOW + HOUR)).toBe(false);
  });

  it('expires after six hours', async () => {
    await markNotified(LAT, LNG, NOW);
    expect(await isInCooldown(LAT, LNG, NOW + 6 * HOUR - 1)).toBe(true);
    expect(await isInCooldown(LAT, LNG, NOW + 6 * HOUR)).toBe(false);
  });

  it('prunes expired entries on write', async () => {
    await markNotified(LAT, LNG, NOW);
    await markNotified(LAT + 1, LNG + 1, NOW + 7 * HOUR);
    const entries = JSON.parse(mockStore.get(FILE)!);
    expect(entries).toHaveLength(1);
    expect(entries[0].lat).toBe(LAT + 1);
  });

  it('tolerates the legacy per-cluster map format', async () => {
    mockStore.set(FILE, JSON.stringify({ 'some-cluster': NOW }));
    expect(await isInCooldown(LAT, LNG, NOW)).toBe(false);
  });

  it('tolerates corrupt JSON', async () => {
    mockStore.set(FILE, 'not json{{');
    expect(await isInCooldown(LAT, LNG, NOW)).toBe(false);
    await expect(markNotified(LAT, LNG, NOW)).resolves.toBeUndefined();
  });
});
