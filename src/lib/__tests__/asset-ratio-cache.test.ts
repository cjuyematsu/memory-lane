import {
  applyHydratedRatios,
  getAssetRatio,
  parseRatios,
  serializeRatios,
  setAssetRatio,
} from '@/lib/asset-ratio-cache';

describe('asset-ratio-cache', () => {
  it('stores and returns a ratio by id', () => {
    setAssetRatio('a', 1.5);
    expect(getAssetRatio('a')).toBe(1.5);
  });

  it('returns undefined for an unknown id', () => {
    expect(getAssetRatio('never-set')).toBeUndefined();
  });

  it('ignores non-finite and non-positive ratios', () => {
    setAssetRatio('nan', Number.NaN);
    setAssetRatio('inf', Number.POSITIVE_INFINITY);
    setAssetRatio('zero', 0);
    setAssetRatio('neg', -2);
    expect(getAssetRatio('nan')).toBeUndefined();
    expect(getAssetRatio('inf')).toBeUndefined();
    expect(getAssetRatio('zero')).toBeUndefined();
    expect(getAssetRatio('neg')).toBeUndefined();
  });

  it('overwrites an existing id without evicting', () => {
    setAssetRatio('b', 1.0);
    setAssetRatio('b', 2.0);
    expect(getAssetRatio('b')).toBe(2.0);
  });

  it('evicts the oldest entry once over the cap (FIFO)', () => {
    // Cap is 3000; insert enough fresh ids to push past it and confirm the
    // earliest survivor is gone while a later one remains.
    const first = 'cap-0';
    setAssetRatio(first, 1.1);
    for (let i = 1; i <= 3000; i++) setAssetRatio(`cap-${i}`, 1 + i / 1000);
    expect(getAssetRatio(first)).toBeUndefined();
    expect(getAssetRatio('cap-3000')).toBeDefined();
  });
});

describe('serializeRatios / parseRatios (persistence codec)', () => {
  it('round-trips a map', () => {
    const map = new Map<string, number>([
      ['ph://a', 1.5],
      ['ph://b', 0.75],
    ]);
    expect(parseRatios(serializeRatios(map))).toEqual([
      ['ph://a', 1.5],
      ['ph://b', 0.75],
    ]);
  });

  it('keeps only the NEWEST cap entries on serialize (insertion-order tail)', () => {
    const map = new Map<string, number>([
      ['old', 1],
      ['mid', 2],
      ['new', 3],
    ]);
    expect(parseRatios(serializeRatios(map, 2))).toEqual([
      ['mid', 2],
      ['new', 3],
    ]);
  });

  it('caps on parse so a tampered file cannot balloon memory', () => {
    const big = Object.fromEntries(
      Array.from({ length: 10 }, (_, i) => [`id-${i}`, 1 + i])
    );
    expect(parseRatios(JSON.stringify(big), 3)).toHaveLength(3);
  });

  it('drops junk values but keeps valid siblings', () => {
    const text = JSON.stringify({
      good: 1.33,
      zero: 0,
      negative: -2,
      nan: 'not-a-number',
      alsoGood: 0.5625,
    });
    expect(parseRatios(text)).toEqual([
      ['good', 1.33],
      ['alsoGood', 0.5625],
    ]);
  });

  it('tolerates non-object and corrupt payloads', () => {
    expect(parseRatios('null')).toEqual([]);
    expect(parseRatios('[1,2,3]')).toEqual([]);
    expect(parseRatios('42')).toEqual([]);
    expect(parseRatios('{not json')).toEqual([]);
  });
});

describe('applyHydratedRatios (boot merge order)', () => {
  it('a full-cap hydration cannot evict this session’s entries', () => {
    setAssetRatio('hydrate-session-fresh', 2);
    const persisted = Array.from(
      { length: 3000 },
      (_, i) => [`hydrated-${i}`, 1] as [string, number]
    );
    applyHydratedRatios(persisted);
    // The session entry survives (cap evictions land on hydrated entries)…
    expect(getAssetRatio('hydrate-session-fresh')).toBe(2);
    // …and it sits at the tail: the next insert evicts a hydrated entry, not it.
    setAssetRatio('hydrate-one-more', 3);
    expect(getAssetRatio('hydrate-session-fresh')).toBe(2);
    expect(getAssetRatio('hydrate-one-more')).toBe(3);
  });

  it('a session value wins over a persisted duplicate', () => {
    setAssetRatio('hydrate-dup', 2);
    applyHydratedRatios([['hydrate-dup', 9]]);
    expect(getAssetRatio('hydrate-dup')).toBe(2);
  });
});
