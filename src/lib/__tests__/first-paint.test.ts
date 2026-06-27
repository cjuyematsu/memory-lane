import {
  __resetFirstPaintForTests,
  hasFirstPainted,
  markFirstPaint,
  whenFirstPaint,
} from '@/lib/first-paint';

describe('first-paint latch', () => {
  beforeEach(() => {
    __resetFirstPaintForTests();
    jest.useRealTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('starts un-painted', () => {
    expect(hasFirstPainted()).toBe(false);
  });

  it('markFirstPaint flips the latch and is idempotent', () => {
    markFirstPaint();
    expect(hasFirstPainted()).toBe(true);
    markFirstPaint();
    expect(hasFirstPainted()).toBe(true);
  });

  it('whenFirstPaint resolves immediately when already painted', async () => {
    markFirstPaint();
    await expect(whenFirstPaint(10_000)).resolves.toBeUndefined();
  });

  it('whenFirstPaint resolves when paint happens before the timeout', async () => {
    jest.useFakeTimers();
    let resolved = false;
    const p = whenFirstPaint(10_000).then(() => {
      resolved = true;
    });
    expect(resolved).toBe(false);
    markFirstPaint();
    await p;
    expect(resolved).toBe(true);
  });

  it('whenFirstPaint resolves via the timeout if paint never happens', async () => {
    jest.useFakeTimers();
    let resolved = false;
    const p = whenFirstPaint(4000).then(() => {
      resolved = true;
    });
    jest.advanceTimersByTime(3999);
    await Promise.resolve();
    expect(resolved).toBe(false);
    jest.advanceTimersByTime(1);
    await p;
    expect(resolved).toBe(true);
    // The timeout must NOT mark the feed as painted — it's only a fallback.
    expect(hasFirstPainted()).toBe(false);
  });

  it('resolves every concurrent waiter on a single paint', async () => {
    jest.useFakeTimers();
    const flags = [false, false, false, false, false];
    const ps = flags.map((_, i) =>
      whenFirstPaint(10_000).then(() => {
        flags[i] = true;
      })
    );
    markFirstPaint();
    await Promise.all(ps);
    expect(flags).toEqual([true, true, true, true, true]);
  });

  it('does not double-resolve: a timeout firing after paint is harmless', async () => {
    jest.useFakeTimers();
    const fn = jest.fn();
    const p = whenFirstPaint(1000).then(fn);
    markFirstPaint();
    await p;
    jest.advanceTimersByTime(5000);
    await Promise.resolve();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('resolves a waiter registered after paint (immediate path)', async () => {
    markFirstPaint();
    const fn = jest.fn();
    await whenFirstPaint(1000).then(fn);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('clears its waiter set on paint so later calls take the immediate path', async () => {
    jest.useFakeTimers();
    const p = whenFirstPaint(10_000);
    markFirstPaint();
    await p;
    await expect(whenFirstPaint(10_000)).resolves.toBeUndefined();
  });

  it('handles a burst of waiters with mixed timeouts, all resolved by paint', async () => {
    jest.useFakeTimers();
    const done: number[] = [];
    const ps = [50, 100, 4000, 60_000].map((t, i) =>
      whenFirstPaint(t).then(() => done.push(i))
    );
    // Paint before the shortest timeout — none should resolve via timeout.
    markFirstPaint();
    await Promise.all(ps);
    expect(done.sort()).toEqual([0, 1, 2, 3]);
  });

  it('reset returns to un-painted for cross-suite isolation', () => {
    markFirstPaint();
    expect(hasFirstPainted()).toBe(true);
    __resetFirstPaintForTests();
    expect(hasFirstPainted()).toBe(false);
  });
});
