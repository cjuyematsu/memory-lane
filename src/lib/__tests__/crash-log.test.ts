import {
  appendEntry,
  describeError,
  formatCrashLog,
  MAX_ENTRIES,
  parseCrashLog,
  type CrashEntry,
} from '@/lib/crash-log';

function entry(overrides: Partial<CrashEntry> = {}): CrashEntry {
  return {
    at: 1700000000000,
    kind: 'error',
    name: 'Error',
    message: 'boom',
    ...overrides,
  };
}

describe('describeError', () => {
  it('describes a real Error with stack', () => {
    const err = new TypeError('bad thing');
    const d = describeError(err);
    expect(d.name).toBe('TypeError');
    expect(d.message).toBe('bad thing');
    expect(typeof d.stack).toBe('string');
  });

  it('truncates the stack', () => {
    const err = new Error('x');
    err.stack = 'a'.repeat(5000);
    expect(describeError(err, 100).stack).toHaveLength(100);
  });

  it('handles string throwables', () => {
    const d = describeError('plain string failure');
    expect(d.name).toBe('string');
    expect(d.message).toBe('plain string failure');
    expect(d.stack).toBeUndefined();
  });

  it('handles null and undefined', () => {
    expect(describeError(null).message).toBe('null');
    expect(describeError(undefined).message).toBe('undefined');
  });

  it('handles a hostile toString without throwing', () => {
    const hostile = {
      toString() {
        throw new Error('nope');
      },
    };
    const d = describeError(hostile);
    expect(d.name).toBe('unknown');
    expect(d.message).toBe('unprintable error');
  });

  it('truncates absurdly long messages', () => {
    const d = describeError(new Error('m'.repeat(10000)));
    expect(d.message.length).toBeLessThanOrEqual(500);
  });
});

describe('appendEntry', () => {
  it('appends below the cap', () => {
    const out = appendEntry([entry()], entry({ message: 'second' }));
    expect(out).toHaveLength(2);
    expect(out[1].message).toBe('second');
  });

  it('rotates at the cap, dropping the oldest', () => {
    let out: CrashEntry[] = [];
    for (let i = 0; i < MAX_ENTRIES + 5; i++) {
      out = appendEntry(out, entry({ message: `e${i}` }));
    }
    expect(out).toHaveLength(MAX_ENTRIES);
    expect(out[0].message).toBe('e5');
    expect(out[out.length - 1].message).toBe(`e${MAX_ENTRIES + 4}`);
  });

  it('does not mutate the input array', () => {
    const input = [entry()];
    appendEntry(input, entry());
    expect(input).toHaveLength(1);
  });
});

describe('parseCrashLog', () => {
  it('returns [] for null, junk text, and non-array JSON', () => {
    expect(parseCrashLog(null)).toEqual([]);
    expect(parseCrashLog('not json {')).toEqual([]);
    expect(parseCrashLog('{"a":1}')).toEqual([]);
    expect(parseCrashLog('42')).toEqual([]);
  });

  it('round-trips valid entries', () => {
    const entries = [
      entry({ tag: 'shareHost', stack: 'at foo', crumbs: ['12ms launch'] }),
      entry({ kind: 'fatal' }),
    ];
    expect(parseCrashLog(JSON.stringify(entries))).toEqual(entries);
  });

  it('drops corrupt elements and keeps good ones', () => {
    const good = entry();
    const text = JSON.stringify([
      good,
      null,
      'junk',
      { at: 'not a number', kind: 'error', name: 'E', message: 'm' },
      { at: 1, kind: 'unknown-kind', name: 'E', message: 'm' },
      { at: 1, kind: 'error', name: 5, message: 'm' },
      [],
    ]);
    expect(parseCrashLog(text)).toEqual([good]);
  });

  it('filters non-string crumbs instead of rejecting the entry', () => {
    const text = JSON.stringify([entry({ crumbs: ['ok', 42, null, 'also ok'] as never })]);
    const out = parseCrashLog(text);
    expect(out).toHaveLength(1);
    expect(out[0].crumbs).toEqual(['ok', 'also ok']);
  });
});

describe('formatCrashLog', () => {
  it('reports emptiness plainly', () => {
    expect(formatCrashLog([])).toBe('No errors recorded.');
  });

  it('lists newest first with tag, stack, and crumbs', () => {
    const text = formatCrashLog([
      entry({ message: 'older' }),
      entry({
        at: 1700000001000,
        kind: 'boundary',
        tag: 'shareHost',
        message: 'newer',
        stack: 'at render',
        crumbs: ['3ms launch'],
      }),
    ]);
    expect(text.indexOf('newer')).toBeLessThan(text.indexOf('older'));
    expect(text).toContain('boundary (shareHost)');
    expect(text).toContain('at render');
    expect(text).toContain('  3ms launch');
  });

  it('contains no em dash', () => {
    const text = formatCrashLog([entry({ tag: 't', stack: 's', crumbs: ['c'] })]);
    expect(text).not.toContain('—');
  });
});
