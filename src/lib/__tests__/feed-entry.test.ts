import { entryCandidateOrder } from '@/lib/feed-entry';

// Deterministic RNG: cycles through the given values.
function seq(values: number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length];
}

describe('entryCandidateOrder', () => {
  it('returns nothing for an empty library', () => {
    expect(entryCandidateOrder(0)).toEqual([]);
  });

  it('probes random picks first, then the newest as a fallback', () => {
    // rand -> indices 5, 5, 2 (dup 5 dropped); then recent 0,1 appended.
    const order = entryCandidateOrder(100, seq([0.05, 0.05, 0.02]), 3, 2);
    expect(order).toEqual([5, 2, 0, 1]);
  });

  it('never repeats an index', () => {
    const order = entryCandidateOrder(10, seq([0.0, 0.1, 0.2]), 30, 10);
    expect(new Set(order).size).toBe(order.length);
  });

  it('keeps every index in range', () => {
    const order = entryCandidateOrder(7, Math.random, 50, 50);
    for (const i of order) {
      expect(i).toBeGreaterThanOrEqual(0);
      expect(i).toBeLessThan(7);
    }
  });

  it('always includes the newest photos when the library is small', () => {
    // tiny library: recent pass covers all indices regardless of the random pass
    const order = entryCandidateOrder(3, seq([0.99]), 5, 3);
    expect(order).toEqual(expect.arrayContaining([0, 1, 2]));
  });

  it('recentN = 0 yields a random-only order with no appended newest block', () => {
    // The feed's cold-launch entry uses recentN = 0 so an offloaded library
    // can never fall through to "always the newest photo". Random picks land
    // on 90 and 40; nothing else — in particular not 0..N newest — appears.
    const order = entryCandidateOrder(100, seq([0.9, 0.4]), 4, 0);
    expect(order).toEqual([90, 40]);
  });
});
