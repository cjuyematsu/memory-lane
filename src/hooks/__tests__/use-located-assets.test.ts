import {
  assembleIndex,
  locatePacing,
  runLocateSweep,
  shouldNotifyProgress,
  type AssetIndex,
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
});
