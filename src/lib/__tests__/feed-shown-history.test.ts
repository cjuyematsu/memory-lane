import {
  __resetShownHistoryForTests,
  markShown,
  shouldSkipShown,
  SHOWN_HISTORY_CAP,
  SHOWN_HISTORY_MIN_LIBRARY,
} from '@/lib/feed-shown-history';

const BIG = SHOWN_HISTORY_MIN_LIBRARY * 10;

describe('feed-shown-history', () => {
  beforeEach(() => __resetShownHistoryForTests());

  it('skips a shown id on a large library', () => {
    markShown('x');
    expect(shouldSkipShown('x', BIG)).toBe(true);
    expect(shouldSkipShown('y', BIG)).toBe(false);
  });

  it('never skips on a small library, so bounded samplers cannot starve', () => {
    markShown('x');
    expect(shouldSkipShown('x', SHOWN_HISTORY_MIN_LIBRARY - 1)).toBe(false);
    expect(shouldSkipShown('x', 1)).toBe(false);
  });

  it('evicts the oldest entry past the cap', () => {
    for (let i = 0; i < SHOWN_HISTORY_CAP + 1; i++) markShown(`p${i}`);
    expect(shouldSkipShown('p0', BIG)).toBe(false);
    expect(shouldSkipShown('p1', BIG)).toBe(true);
    expect(shouldSkipShown(`p${SHOWN_HISTORY_CAP}`, BIG)).toBe(true);
  });

  it('re-showing an id refreshes its position instead of duplicating', () => {
    markShown('x');
    // Fill to one below eviction of x, then re-show x and push more: x must
    // survive longer than its original slot would have.
    for (let i = 0; i < SHOWN_HISTORY_CAP - 1; i++) markShown(`p${i}`);
    markShown('x');
    for (let i = 0; i < SHOWN_HISTORY_CAP - 1; i++) markShown(`q${i}`);
    expect(shouldSkipShown('x', BIG)).toBe(true);
    expect(shouldSkipShown('p0', BIG)).toBe(false);
  });

  it('the exact repeat scenario: a shown old memory cannot be re-picked for ~40 shuffles', () => {
    markShown('old-photo');
    for (let i = 0; i < SHOWN_HISTORY_CAP - 1; i++) {
      expect(shouldSkipShown('old-photo', BIG)).toBe(true);
      markShown(`other-${i}`);
    }
    expect(shouldSkipShown('old-photo', BIG)).toBe(true);
    markShown('one-more');
    expect(shouldSkipShown('old-photo', BIG)).toBe(false);
  });
});
