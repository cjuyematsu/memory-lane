import {
  isRoutineLocation,
  recordPresence,
  ROUTINE_DAY_THRESHOLD,
  routineDayCount,
} from '@/lib/place-presence';

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
const BASE = 1_800_000_000_000;
const LAT = 34.0;
const LNG = -117.0;
const NEAR_LAT = 34.0005; // ~55m north — inside the 150m home zone
const FAR_LAT = 34.002; // ~222m north — outside the home zone

// Record one visit per day for `n` consecutive distinct days starting at `start`.
async function recordDays(lat: number, lng: number, n: number, start = BASE) {
  for (let i = 0; i < n; i++) await recordPresence(lat, lng, start + i * DAY);
}

beforeEach(() => mockStore.clear());

describe('place-presence', () => {
  it('dedups multiple visits on the same day to one', async () => {
    await recordPresence(LAT, LNG, BASE);
    await recordPresence(LAT, LNG, BASE + 60 * 1000); // minutes later, same day
    expect(await routineDayCount(LAT, LNG, BASE)).toBe(1);
  });

  it('counts distinct days', async () => {
    await recordDays(LAT, LNG, 3);
    expect(await routineDayCount(LAT, LNG, BASE + 2 * DAY)).toBe(3);
  });

  it('flags a place routine only once the distinct-day threshold is met', async () => {
    await recordDays(LAT, LNG, ROUTINE_DAY_THRESHOLD - 1);
    expect(
      await isRoutineLocation(LAT, LNG, BASE + (ROUTINE_DAY_THRESHOLD - 2) * DAY)
    ).toBe(false);

    await recordPresence(LAT, LNG, BASE + (ROUTINE_DAY_THRESHOLD - 1) * DAY);
    expect(
      await isRoutineLocation(LAT, LNG, BASE + (ROUTINE_DAY_THRESHOLD - 1) * DAY)
    ).toBe(true);
  });

  it('aggregates visits within the 150m home zone (home spans cells)', async () => {
    await recordPresence(LAT, LNG, BASE);
    await recordPresence(NEAR_LAT, LNG, BASE + DAY); // ~55m away, next day
    await recordPresence(LAT, LNG, BASE + 2 * DAY);
    expect(await routineDayCount(LAT, LNG, BASE + 2 * DAY)).toBe(3);
  });

  it('treats places more than ~150m apart as different', async () => {
    await recordDays(LAT, LNG, ROUTINE_DAY_THRESHOLD); // home → routine
    await recordPresence(FAR_LAT, LNG, BASE); // a one-off elsewhere
    const now = BASE + (ROUTINE_DAY_THRESHOLD - 1) * DAY;
    expect(await isRoutineLocation(LAT, LNG, now)).toBe(true);
    expect(await isRoutineLocation(FAR_LAT, LNG, now)).toBe(false);
    expect(await routineDayCount(FAR_LAT, LNG, now)).toBe(1);
  });

  it('forgets a place after the rolling window — you moved away', async () => {
    await recordDays(LAT, LNG, ROUTINE_DAY_THRESHOLD);
    expect(
      await isRoutineLocation(LAT, LNG, BASE + (ROUTINE_DAY_THRESHOLD - 1) * DAY)
    ).toBe(true);
    // Three weeks later with no further visits: the old presence has aged out,
    // so the place becomes a surfaceable memory again.
    const later = BASE + 21 * DAY;
    expect(await routineDayCount(LAT, LNG, later)).toBe(0);
    expect(await isRoutineLocation(LAT, LNG, later)).toBe(false);
  });

  it('prunes out-of-window entries on write so the file stays small', async () => {
    await recordDays(LAT, LNG, 3);
    await recordPresence(LAT, LNG, BASE + 20 * DAY); // far in the future
    const stored = JSON.parse(mockStore.get('place-presence.json')!);
    expect(stored).toHaveLength(1); // the three old days were pruned
  });
});
