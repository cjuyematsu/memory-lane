import { TimeoutError, withRetry, withTimeout, withTimeoutDefault } from '@/lib/async-safety';

describe('withTimeout', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('resolves with the value when it settles before the deadline', async () => {
    await expect(withTimeout(Promise.resolve('ok'), 1000)).resolves.toBe('ok');
  });

  it('propagates the original rejection when it settles first', async () => {
    const boom = new Error('boom');
    await expect(withTimeout(Promise.reject(boom), 1000)).rejects.toBe(boom);
  });

  it('rejects with TimeoutError once the deadline passes', async () => {
    const p = withTimeout(new Promise(() => {}), 1000, 'thing');
    jest.advanceTimersByTime(1000);
    await expect(p).rejects.toBeInstanceOf(TimeoutError);
  });

  it('does not fire the timeout when the promise wins the race', async () => {
    const p = withTimeout(Promise.resolve('fast'), 1000);
    await expect(p).resolves.toBe('fast');
    jest.advanceTimersByTime(2000); // must not produce an unhandled rejection
  });
});

describe('withTimeoutDefault', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('resolves with the value when it settles before the deadline', async () => {
    await expect(withTimeoutDefault(Promise.resolve(7), 1000, -1)).resolves.toBe(7);
  });

  it('resolves the fallback when the promise rejects', async () => {
    await expect(
      withTimeoutDefault(Promise.reject(new Error('x')), 1000, 'fallback')
    ).resolves.toBe('fallback');
  });

  it('resolves the fallback once the deadline passes', async () => {
    const p = withTimeoutDefault(new Promise<string>(() => {}), 1000, 'fallback');
    jest.advanceTimersByTime(1000);
    await expect(p).resolves.toBe('fallback');
  });

  it('ignores a late resolution after the fallback already won', async () => {
    let resolveLate: (v: string) => void = () => {};
    const slow = new Promise<string>((r) => {
      resolveLate = r;
    });
    const p = withTimeoutDefault(slow, 1000, 'fallback');
    jest.advanceTimersByTime(1000);
    resolveLate('too-late');
    await expect(p).resolves.toBe('fallback');
  });
});

describe('withRetry', () => {
  it('returns immediately when the first attempt succeeds', async () => {
    const factory = jest.fn(() => Promise.resolve('done'));
    await expect(withRetry(factory, 3, 1)).resolves.toBe('done');
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('retries until an attempt succeeds', async () => {
    let calls = 0;
    const factory = jest.fn(() => {
      calls += 1;
      return calls < 3 ? Promise.reject(new Error('e')) : Promise.resolve('done');
    });
    await expect(withRetry(factory, 3, 1)).resolves.toBe('done');
    expect(factory).toHaveBeenCalledTimes(3);
  });

  it('rejects with the last error after exhausting retries', async () => {
    let calls = 0;
    const last = new Error('last');
    const factory = jest.fn(() => {
      calls += 1;
      return Promise.reject(calls === 4 ? last : new Error('e'));
    });
    await expect(withRetry(factory, 3, 1)).rejects.toBe(last);
    expect(factory).toHaveBeenCalledTimes(4); // initial + 3 retries
  });
});
