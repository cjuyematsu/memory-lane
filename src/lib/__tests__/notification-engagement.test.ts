import {
  isSuppressed,
  recordEngaged,
  recordSurfaced,
} from '@/lib/notification-engagement';

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

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_800_000_000_000;
const ID = '68000,-234000';

beforeEach(() => {
  mockStore.clear();
});

describe('notification engagement', () => {
  it('is not suppressed by default', async () => {
    expect(await isSuppressed(ID, NOW)).toBe(false);
  });

  it('stays unsuppressed below the surface limit', async () => {
    await recordSurfaced(ID, NOW);
    await recordSurfaced(ID, NOW);
    expect(await isSuppressed(ID, NOW)).toBe(false);
  });

  it('suppresses after three un-engaged surfaces, for 30 days', async () => {
    await recordSurfaced(ID, NOW);
    await recordSurfaced(ID, NOW);
    await recordSurfaced(ID, NOW);
    expect(await isSuppressed(ID, NOW)).toBe(true);
    expect(await isSuppressed(ID, NOW + 30 * DAY - 1)).toBe(true);
    expect(await isSuppressed(ID, NOW + 30 * DAY)).toBe(false);
  });

  it('tracks clusters independently', async () => {
    await recordSurfaced(ID, NOW);
    await recordSurfaced(ID, NOW);
    await recordSurfaced(ID, NOW);
    expect(await isSuppressed('other', NOW)).toBe(false);
  });

  it('engaging clears the count and any suppression', async () => {
    await recordSurfaced(ID, NOW);
    await recordSurfaced(ID, NOW);
    await recordSurfaced(ID, NOW);
    expect(await isSuppressed(ID, NOW)).toBe(true);
    await recordEngaged(ID);
    expect(await isSuppressed(ID, NOW)).toBe(false);
    // Counter restarted: two more surfaces shouldn't re-suppress.
    await recordSurfaced(ID, NOW);
    await recordSurfaced(ID, NOW);
    expect(await isSuppressed(ID, NOW)).toBe(false);
  });

  it('tolerates corrupt JSON', async () => {
    mockStore.set('notification-engagement.json', '][');
    expect(await isSuppressed(ID, NOW)).toBe(false);
    await expect(recordSurfaced(ID, NOW)).resolves.toBeUndefined();
  });
});
