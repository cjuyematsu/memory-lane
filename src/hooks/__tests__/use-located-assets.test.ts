import {
  assembleIndex,
  locatePacing,
  parseAssetIndex,
  parseLocatedAsset,
  parseUnlocatedVideo,
  runLocateSweep,
  shouldNotifyProgress,
  sweepPacing,
  type AssetIndex,
  type LocatedAsset,
  type LocateResult,
} from '@/hooks/use-located-assets';
import type { Asset } from 'expo-media-library';

// use-located-assets value-imports expo-media-library and pulls in the metadata
// + persisted-file modules at the top level; locatePacing touches none of them,
// so stub them out to keep this a pure-logic test with no native/disk access
// (the real expo-media-library native module can't load under jest). Mirrors
// use-nearby-assets.test.ts.
jest.mock('expo-media-library', () => ({
  MediaType: { IMAGE: 'photo', VIDEO: 'video', AUDIO: 'audio', UNKNOWN: 'unknown' },
}));
jest.mock('@/hooks/use-asset-metadata', () => ({
  loadAssetTimeLocation: jest.fn(),
}));
jest.mock('@/lib/persisted-file', () => ({
  persistedFile: jest.fn(),
  readPersisted: jest.fn(),
}));

describe('locatePacing', () => {
  it('runs small / incremental syncs with no inter-batch delay', () => {
    expect(locatePacing(0)).toEqual({ concurrency: 4, interBatchDelayMs: 0 });
    expect(locatePacing(1)).toEqual({ concurrency: 4, interBatchDelayMs: 0 });
    expect(locatePacing(200)).toEqual({ concurrency: 4, interBatchDelayMs: 0 });
  });

  it('paces a large first sweep with a breather between batches', () => {
    expect(locatePacing(201).interBatchDelayMs).toBeGreaterThan(0);
    expect(locatePacing(10000).interBatchDelayMs).toBeGreaterThan(0);
  });

  it('always keeps a positive concurrency so the sweep makes progress', () => {
    for (const n of [0, 1, 200, 201, 5000, 10000]) {
      expect(locatePacing(n).concurrency).toBeGreaterThanOrEqual(1);
    }
  });

  it('switches to paced mode at exactly threshold + 1', () => {
    // 200 = still the snappy path; 201 = first paced sweep.
    expect(locatePacing(200).interBatchDelayMs).toBe(0);
    expect(locatePacing(201).interBatchDelayMs).toBeGreaterThan(0);
  });

  it('is monotonic: a larger sweep never paces less than a smaller one', () => {
    let prev = -1;
    for (const n of [0, 1, 200, 201, 1000, 10000]) {
      const d = locatePacing(n).interBatchDelayMs;
      expect(d).toBeGreaterThanOrEqual(prev === -1 ? 0 : 0);
      prev = d;
    }
    expect(locatePacing(10000).interBatchDelayMs).toBeGreaterThanOrEqual(
      locatePacing(201).interBatchDelayMs
    );
  });

  it('keeps the paced delay small enough to stay reasonable on a huge library', () => {
    // Guardrail: a 10k first sweep shouldn't add more than ~30s of pure delay
    // (delay * batches). If someone bumps the delay way up, this fails loudly.
    const { concurrency, interBatchDelayMs } = locatePacing(10000);
    const batches = Math.ceil(10000 / concurrency);
    expect(batches * interBatchDelayMs).toBeLessThanOrEqual(30_000);
  });
});

describe('shouldNotifyProgress', () => {
  const STEP = 200;

  it('always notifies on the first tick', () => {
    expect(shouldNotifyProgress(0, 9800, 0, STEP)).toBe(true);
  });

  it('always notifies on completion', () => {
    expect(shouldNotifyProgress(9800, 9800, 9700, STEP)).toBe(true);
    expect(shouldNotifyProgress(10000, 9800, 9700, STEP)).toBe(true);
  });

  it('suppresses ticks within the step window', () => {
    expect(shouldNotifyProgress(150, 9800, 0, STEP)).toBe(false);
    expect(shouldNotifyProgress(199, 9800, 0, STEP)).toBe(false);
  });

  it('notifies once the step is crossed', () => {
    expect(shouldNotifyProgress(200, 9800, 0, STEP)).toBe(true);
    expect(shouldNotifyProgress(401, 9800, 200, STEP)).toBe(true);
  });

  it('emits a bounded number of updates over a full 10k sweep', () => {
    let last = -Infinity;
    let count = 0;
    for (let processed = 0; processed <= 10000; processed += 4) {
      if (shouldNotifyProgress(processed, 10000, last, STEP)) {
        last = processed;
        count += 1;
      }
    }
    // ~50 (every 200) + endpoints — comfortably under a churny threshold.
    expect(count).toBeLessThanOrEqual(60);
    expect(count).toBeGreaterThan(10);
  });
});

const ids = (n: number): Asset[] =>
  Array.from({ length: n }, (_, i) => ({ id: `a${i}` })) as unknown as Asset[];
const none = (): LocateResult => ({ kind: 'none' });

describe('assembleIndex', () => {
  const kept: AssetIndex = {
    located: [{ id: 'k', lat: 1, lng: 2, creationTime: 10, mediaType: 'photo' as never }],
    unlocatedVideos: [],
    processedIds: ['k'],
  };

  it('appends located + unlocated onto the kept base, recording every processed id', () => {
    const assets = ids(3); // a0,a1,a2
    const results: LocateResult[] = [
      { kind: 'located', value: { id: 'a0', lat: 5, lng: 6, creationTime: 1, mediaType: 'photo' as never } },
      { kind: 'none' },
      { kind: 'unlocatedVideo', value: { id: 'a2', creationTime: 9 } },
    ];
    const idx = assembleIndex(kept, assets, results);
    expect(idx.processedIds).toEqual(['k', 'a0', 'a1', 'a2']);
    expect(idx.located.map((l) => l.id)).toEqual(['k', 'a0']);
    expect(idx.unlocatedVideos.map((v) => v.id)).toEqual(['a2']);
  });

  it('leaves a failed read OUT of processedIds so the next sync retries it', () => {
    // The bug this guards: a thrown/timed-out locate used to be recorded as
    // processed-with-no-location, permanently dropping the photo from Near Me,
    // clusters, and geofences after one transient failure.
    const assets = ids(4); // a0..a3
    const results: LocateResult[] = [
      { kind: 'failed' },
      { kind: 'located', value: { id: 'a1', lat: 5, lng: 6, creationTime: 1, mediaType: 'photo' as never } },
      { kind: 'failed' },
      { kind: 'none' },
    ];
    const idx = assembleIndex(kept, assets, results);
    expect(idx.processedIds).toEqual(['k', 'a1', 'a3']);
    expect(idx.located.map((l) => l.id)).toEqual(['k', 'a1']);
    expect(idx.unlocatedVideos).toEqual([]);
  });

  it('a successful no-GPS read (none) IS processed, so it is never re-read', () => {
    const idx = assembleIndex(kept, ids(1), [{ kind: 'none' }]);
    expect(idx.processedIds).toEqual(['k', 'a0']);
  });

  it('does not mutate the kept base (so checkpoints can reuse it)', () => {
    const base: AssetIndex = { located: [], unlocatedVideos: [], processedIds: [] };
    assembleIndex(base, ids(1), [none()]);
    expect(base).toEqual({ located: [], unlocatedVideos: [], processedIds: [] });
  });
});

describe('runLocateSweep', () => {
  const fast = { concurrency: 5, interBatchDelayMs: 0 };

  it('locates every asset and returns one result each, in order', async () => {
    const seen: string[] = [];
    const results = await runLocateSweep(ids(23), {
      locate: async (a) => {
        seen.push(a.id);
        return none();
      },
      pacing: fast,
      checkpointEvery: 1000,
    });
    expect(results).toHaveLength(23);
    expect(seen).toHaveLength(23);
  });

  it('carries failed results through in order, and a checkpoint built from them skips those ids', async () => {
    const results = await runLocateSweep(ids(6), {
      locate: async (a) => (a.id === 'a1' || a.id === 'a4' ? { kind: 'failed' } : none()),
      pacing: { concurrency: 3, interBatchDelayMs: 0 },
      checkpointEvery: 1000,
    });
    expect(results.map((r) => r.kind)).toEqual(['none', 'failed', 'none', 'none', 'failed', 'none']);
    const idx = assembleIndex({ located: [], unlocatedVideos: [], processedIds: [] }, ids(6), results);
    expect(idx.processedIds).toEqual(['a0', 'a2', 'a3', 'a5']);
  });

  it('checkpoints on cadence but never on the final batch', async () => {
    const checkpoints: number[] = [];
    await runLocateSweep(ids(30), {
      locate: async () => none(),
      pacing: fast, // batches of 5 -> 5,10,15,20,25,30
      checkpointEvery: 10,
      onCheckpoint: (out) => checkpoints.push(out.length),
    });
    // since>=10 fires at 10 and 20; at 30 since>=10 too but out===total -> skipped.
    expect(checkpoints).toEqual([10, 20]);
  });

  it('reports cumulative progress after each batch', async () => {
    const done: number[] = [];
    await runLocateSweep(ids(12), {
      locate: async () => none(),
      pacing: { concurrency: 4, interBatchDelayMs: 0 },
      checkpointEvery: 1000,
      onProgress: (n) => done.push(n),
    });
    expect(done).toEqual([4, 8, 12]);
  });

  it('never checkpoints when the sweep is smaller than the interval', async () => {
    const checkpoints: number[] = [];
    await runLocateSweep(ids(40), {
      locate: async () => none(),
      pacing: fast,
      checkpointEvery: 1000,
      onCheckpoint: (out) => checkpoints.push(out.length),
    });
    expect(checkpoints).toEqual([]);
  });

  it('re-reads a pacing getter before every batch, so batch sizes shift mid-sweep', async () => {
    let burst = false;
    const batchSizes: number[] = [];
    let pending = 0;
    await runLocateSweep(ids(30), {
      locate: async () => {
        pending += 1;
        return none();
      },
      pacing: () =>
        burst ? { concurrency: 2, interBatchDelayMs: 0 } : { concurrency: 5, interBatchDelayMs: 0 },
      checkpointEvery: 1000,
      onProgress: () => {
        batchSizes.push(pending);
        pending = 0;
        // Flip to burst pacing after the second full-speed batch (10 done).
        if (batchSizes.length === 2) burst = true;
      },
    });
    // 5,5 at full speed, then 2s until the 30 are done.
    expect(batchSizes).toEqual([5, 5, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2]);
  });

  it('defers a due checkpoint while canCheckpointNow is false and fires it on the next allowed batch', async () => {
    let allowed = false;
    const checkpoints: number[] = [];
    await runLocateSweep(ids(30), {
      locate: async () => none(),
      pacing: fast, // batches of 5
      checkpointEvery: 10,
      canCheckpointNow: () => allowed,
      onCheckpoint: (out) => {
        checkpoints.push(out.length);
      },
      onProgress: (n) => {
        // Open the gate once 25 are done (onProgress runs just before the same
        // batch's checkpoint check): the checkpoints due at 10, 15, and 20 were
        // all deferred; the first allowed batch (25) fires one.
        if (n === 25) allowed = true;
      },
    });
    expect(checkpoints).toEqual([25]);
  });

  it('keeps the final-batch skip even when a deferred checkpoint lands on the last batch', async () => {
    let allowed = false;
    const checkpoints: number[] = [];
    await runLocateSweep(ids(20), {
      locate: async () => none(),
      pacing: fast,
      checkpointEvery: 10,
      canCheckpointNow: () => allowed,
      onCheckpoint: (out) => checkpoints.push(out.length),
      onProgress: (n) => {
        if (n === 20) allowed = true;
      },
    });
    // Due at 10 and 15 but deferred (gate closed); by the time the gate opens
    // (20) the sweep is on its final batch, which never checkpoints — the
    // caller persists the complete result itself.
    expect(checkpoints).toEqual([]);
  });
});

describe('sweepPacing', () => {
  it('matches locatePacing when no decode burst is active', () => {
    expect(sweepPacing(50, false)).toEqual(locatePacing(50));
    expect(sweepPacing(10000, false)).toEqual(locatePacing(10000));
  });

  it('drops to a trickle during a decode burst regardless of size', () => {
    const small = sweepPacing(50, true);
    const large = sweepPacing(60000, true);
    expect(small).toEqual(large);
    expect(small.concurrency).toBeLessThan(locatePacing(60000).concurrency);
    expect(small.interBatchDelayMs).toBeGreaterThan(locatePacing(60000).interBatchDelayMs);
  });

  it('keeps a positive concurrency during the burst so the sweep still progresses', () => {
    expect(sweepPacing(60000, true).concurrency).toBeGreaterThan(0);
  });
});

// --- Persisted-index validation ----------------------------------------------

function locatedEntry(overrides: Partial<LocatedAsset> = {}): LocatedAsset {
  return {
    id: 'a1',
    lat: 37.7,
    lng: -119.5,
    creationTime: 1600000000000,
    mediaType: 'photo' as LocatedAsset['mediaType'],
    ...overrides,
  };
}

describe('parseLocatedAsset', () => {
  it('accepts a well-formed entry, including a legit null creationTime', () => {
    expect(parseLocatedAsset(locatedEntry())).toEqual(locatedEntry());
    expect(parseLocatedAsset(locatedEntry({ creationTime: null }))).toEqual(
      locatedEntry({ creationTime: null })
    );
  });

  it('rejects non-objects and missing/empty ids', () => {
    expect(parseLocatedAsset(null)).toBeNull();
    expect(parseLocatedAsset('junk')).toBeNull();
    expect(parseLocatedAsset([])).toBeNull();
    expect(parseLocatedAsset(locatedEntry({ id: '' }))).toBeNull();
    expect(parseLocatedAsset({ ...locatedEntry(), id: 42 })).toBeNull();
  });

  it('rejects NaN, non-number, and out-of-range coordinates', () => {
    expect(parseLocatedAsset(locatedEntry({ lat: NaN }))).toBeNull();
    expect(parseLocatedAsset({ ...locatedEntry(), lng: '-119.5' })).toBeNull();
    expect(parseLocatedAsset(locatedEntry({ lat: 91 }))).toBeNull();
    expect(parseLocatedAsset(locatedEntry({ lat: -91 }))).toBeNull();
    expect(parseLocatedAsset(locatedEntry({ lng: 181 }))).toBeNull();
    expect(parseLocatedAsset(locatedEntry({ lng: -181 }))).toBeNull();
    expect(parseLocatedAsset(locatedEntry({ lat: Infinity }))).toBeNull();
  });

  it('rejects a missing or NaN creationTime (must be number or explicit null)', () => {
    const { creationTime: _omitted, ...noTime } = locatedEntry();
    expect(parseLocatedAsset(noTime)).toBeNull();
    expect(parseLocatedAsset(locatedEntry({ creationTime: NaN }))).toBeNull();
  });

  it('rejects an unknown mediaType instead of guessing', () => {
    expect(parseLocatedAsset({ ...locatedEntry(), mediaType: 'hologram' })).toBeNull();
    expect(parseLocatedAsset({ ...locatedEntry(), mediaType: 7 })).toBeNull();
  });
});

describe('parseUnlocatedVideo', () => {
  it('accepts a well-formed entry', () => {
    expect(parseUnlocatedVideo({ id: 'v1', creationTime: 123 })).toEqual({
      id: 'v1',
      creationTime: 123,
    });
  });

  it('rejects bad ids and non-finite times', () => {
    expect(parseUnlocatedVideo({ id: '', creationTime: 123 })).toBeNull();
    expect(parseUnlocatedVideo({ id: 'v1', creationTime: NaN })).toBeNull();
    expect(parseUnlocatedVideo({ id: 'v1', creationTime: null })).toBeNull();
    expect(parseUnlocatedVideo({ id: 'v1' })).toBeNull();
  });
});

describe('parseAssetIndex', () => {
  const valid: AssetIndex = {
    located: [locatedEntry(), locatedEntry({ id: 'a2', lat: 0, lng: 0 })],
    unlocatedVideos: [{ id: 'v1', creationTime: 5 }],
    processedIds: ['a1', 'a2', 'v1', 'x-no-gps'],
  };

  it('round-trips a valid index', () => {
    expect(parseAssetIndex(JSON.stringify(valid))).toEqual(valid);
  });

  it('returns null for null text, junk text, and wrong container shapes', () => {
    expect(parseAssetIndex(null)).toBeNull();
    expect(parseAssetIndex('{{{')).toBeNull();
    expect(parseAssetIndex('[]')).toBeNull();
    expect(parseAssetIndex('{"located":{}}')).toBeNull();
    expect(parseAssetIndex(JSON.stringify({ located: [], unlocatedVideos: [] }))).toBeNull();
  });

  it('drops corrupt elements and strips their ids from processedIds so they re-locate', () => {
    const corrupt = {
      located: [locatedEntry(), { ...locatedEntry({ id: 'bad-lat' }), lat: 'north' }],
      unlocatedVideos: [
        { id: 'v1', creationTime: 5 },
        { id: 'bad-video', creationTime: 'yesterday' },
      ],
      processedIds: ['a1', 'bad-lat', 'v1', 'bad-video', 'x-no-gps', '', 42],
    };
    const out = parseAssetIndex(JSON.stringify(corrupt));
    expect(out).toEqual({
      located: [locatedEntry()],
      unlocatedVideos: [{ id: 'v1', creationTime: 5 }],
      // bad-lat and bad-video stripped -> re-located next sync; '' and 42 gone too.
      processedIds: ['a1', 'v1', 'x-no-gps'],
    });
  });

  it('tolerates corrupt elements whose id is unreadable (kept out, nothing thrown)', () => {
    const out = parseAssetIndex(
      JSON.stringify({
        located: [null, 'junk', 12, locatedEntry()],
        unlocatedVideos: [[]],
        processedIds: ['a1'],
      })
    );
    expect(out).toEqual({
      located: [locatedEntry()],
      unlocatedVideos: [],
      processedIds: ['a1'],
    });
  });

  it('handles a 60k-entry index with 5% corruption quickly and exactly', () => {
    const located: unknown[] = [];
    const processedIds: string[] = [];
    for (let i = 0; i < 60000; i++) {
      const id = `asset-${i}`;
      processedIds.push(id);
      if (i % 20 === 0) {
        // every 20th entry corrupt: NaN serializes to null -> non-number lat
        located.push({ ...locatedEntry({ id }), lat: null });
      } else {
        located.push(locatedEntry({ id, lat: (i % 180) - 90 + 0.5, lng: (i % 360) - 180 + 0.5 }));
      }
    }
    const text = JSON.stringify({ located, unlocatedVideos: [], processedIds });
    const startedAt = Date.now();
    const out = parseAssetIndex(text);
    const elapsed = Date.now() - startedAt;
    expect(out).not.toBeNull();
    expect(out!.located).toHaveLength(57000);
    expect(out!.processedIds).toHaveLength(57000);
    expect(out!.processedIds).not.toContain('asset-0');
    expect(out!.processedIds).toContain('asset-1');
    // Generous bound: just guards against an accidentally quadratic parse.
    expect(elapsed).toBeLessThan(2000);
  });
});

describe('runLocateSweep at library scale', () => {
  it('sweeps 60k instant-resolve locates with burst flips without stalling or misordering', async () => {
    let burst = false;
    let checkpoints = 0;
    const startedAt = Date.now();
    const results = await runLocateSweep(ids(60000), {
      locate: async () => none(),
      pacing: () =>
        burst ? { concurrency: 2, interBatchDelayMs: 0 } : { concurrency: 8, interBatchDelayMs: 0 },
      checkpointEvery: 2000,
      canCheckpointNow: () => !burst,
      onCheckpoint: () => {
        checkpoints += 1;
      },
      onProgress: (n) => {
        // Toggle the burst on and off through the sweep, like Near Me refreshes would.
        if (n % 10000 < 2000) burst = true;
        else burst = false;
      },
    });
    const elapsed = Date.now() - startedAt;
    expect(results).toHaveLength(60000);
    // Checkpoints still happen outside burst windows, and never explode in count.
    expect(checkpoints).toBeGreaterThan(0);
    expect(checkpoints).toBeLessThanOrEqual(30);
    // Generous CI-safe bound; catches an accidentally quadratic accumulation.
    expect(elapsed).toBeLessThan(5000);
  });
});
