import {
  __resetWarmedEntryForTests,
  __subscribeWarmedEntryForTests,
  getWarmedEntryId,
  setWarmedEntryId,
} from '@/lib/feed-entry-warm';

describe('feed-entry-warm handoff', () => {
  beforeEach(() => {
    __resetWarmedEntryForTests();
  });

  it('starts empty', () => {
    expect(getWarmedEntryId()).toBeNull();
  });

  it('reflects the last set id', () => {
    setWarmedEntryId('ph://abc');
    expect(getWarmedEntryId()).toBe('ph://abc');
    setWarmedEntryId('ph://def');
    expect(getWarmedEntryId()).toBe('ph://def');
  });

  it('notifies subscribers when the id changes', () => {
    const fn = jest.fn();
    __subscribeWarmedEntryForTests(fn);
    setWarmedEntryId('ph://abc');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('does not notify when the id is unchanged (no spurious warm re-render)', () => {
    setWarmedEntryId('ph://abc');
    const fn = jest.fn();
    __subscribeWarmedEntryForTests(fn);
    setWarmedEntryId('ph://abc');
    expect(fn).not.toHaveBeenCalled();
  });

  it('can be cleared back to null', () => {
    setWarmedEntryId('ph://abc');
    setWarmedEntryId(null);
    expect(getWarmedEntryId()).toBeNull();
  });

  it('reset isolates suites', () => {
    setWarmedEntryId('ph://abc');
    __resetWarmedEntryForTests();
    expect(getWarmedEntryId()).toBeNull();
  });
});
