import { getAssetRatio, setAssetRatio } from '@/lib/asset-ratio-cache';

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
