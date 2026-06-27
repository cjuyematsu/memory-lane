import React from 'react';
import TestRenderer from 'react-test-renderer';

import type { Asset } from 'expo-media-library';

import { useNearbyAssets } from '@/hooks/use-nearby-assets';
import { __resetFirstPaintForTests, markFirstPaint } from '@/lib/first-paint';
import * as located from '@/hooks/use-located-assets';

// Mock the heavy/native edges; use the REAL first-paint + relevance-radius so the
// defer wiring under test is exercised end to end.
jest.mock('expo-media-library', () => ({
  MediaType: { IMAGE: 'photo', VIDEO: 'video', AUDIO: 'audio', UNKNOWN: 'unknown' },
}));
const emptyIndex = { located: [], unlocatedVideos: [], processedIds: [] };
jest.mock('@/hooks/use-located-assets', () => ({
  ensureIndex: jest.fn(() => Promise.resolve(emptyIndex)),
  getIndex: jest.fn(() => null),
  invalidateIndex: jest.fn(),
}));
jest.mock('@/hooks/use-photo-clusters', () => ({ getClusters: jest.fn(() => []) }));

const ensureIndex = located.ensureIndex as jest.Mock;
const getIndex = located.getIndex as jest.Mock;

function Harness({ assets }: { assets: Asset[] | null }) {
  useNearbyAssets(assets, null);
  return null;
}

const ASSETS = [{ id: 'a' }, { id: 'b' }] as unknown as Asset[];

async function flush() {
  // Let queued microtasks (the whenFirstPaint .then → run → ensureIndex) settle.
  await Promise.resolve();
  await Promise.resolve();
}

describe('useNearbyAssets cold-build defer', () => {
  beforeEach(() => {
    __resetFirstPaintForTests();
    ensureIndex.mockClear();
    getIndex.mockReturnValue(null);
    jest.useRealTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('does NOT start the build before first paint when there is no index', async () => {
    let tree: TestRenderer.ReactTestRenderer;
    await TestRenderer.act(async () => {
      tree = TestRenderer.create(<Harness assets={ASSETS} />);
      await flush();
    });
    expect(ensureIndex).not.toHaveBeenCalled();

    await TestRenderer.act(async () => {
      markFirstPaint();
      await flush();
    });
    expect(ensureIndex).toHaveBeenCalledWith(ASSETS);

    await TestRenderer.act(async () => {
      tree.unmount();
    });
  });

  it('builds immediately when an index already exists (warm/incremental path)', async () => {
    getIndex.mockReturnValue(emptyIndex);
    await TestRenderer.act(async () => {
      TestRenderer.create(<Harness assets={ASSETS} />);
      await flush();
    });
    expect(ensureIndex).toHaveBeenCalledWith(ASSETS);
  });

  it('builds immediately when the feed has already painted', async () => {
    markFirstPaint();
    await TestRenderer.act(async () => {
      TestRenderer.create(<Harness assets={ASSETS} />);
      await flush();
    });
    expect(ensureIndex).toHaveBeenCalledWith(ASSETS);
  });

  it('falls back to building after the defer timeout when no paint happens', async () => {
    jest.useFakeTimers();
    await TestRenderer.act(async () => {
      TestRenderer.create(<Harness assets={ASSETS} />);
      await Promise.resolve();
    });
    expect(ensureIndex).not.toHaveBeenCalled();

    await TestRenderer.act(async () => {
      jest.advanceTimersByTime(4000);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(ensureIndex).toHaveBeenCalledWith(ASSETS);
  });

  it('never builds with no assets', async () => {
    await TestRenderer.act(async () => {
      TestRenderer.create(<Harness assets={null} />);
      await flush();
    });
    markFirstPaint();
    await flush();
    expect(ensureIndex).not.toHaveBeenCalled();
  });

  it('two Near Me consumers (greeter + tab) both wait, then build after paint', async () => {
    // The greeter and the Near Me tab both mount useNearbyAssets on app open.
    await TestRenderer.act(async () => {
      TestRenderer.create(<Harness assets={ASSETS} />);
      TestRenderer.create(<Harness assets={ASSETS} />);
      await flush();
    });
    expect(ensureIndex).not.toHaveBeenCalled();

    await TestRenderer.act(async () => {
      markFirstPaint();
      await flush();
    });
    // Both consumers fire run(); the real ensureIndex dedups by identity, so it's
    // always handed the same array reference.
    expect(ensureIndex).toHaveBeenCalled();
    for (const call of ensureIndex.mock.calls) expect(call[0]).toBe(ASSETS);
  });

  it('builds the LATEST assets if the library changes during the defer window', async () => {
    const NEXT = [{ id: 'c' }] as unknown as Asset[];
    let tree: TestRenderer.ReactTestRenderer;
    await TestRenderer.act(async () => {
      tree = TestRenderer.create(<Harness assets={ASSETS} />);
      await flush();
    });
    await TestRenderer.act(async () => {
      tree.update(<Harness assets={NEXT} />);
      await flush();
    });
    expect(ensureIndex).not.toHaveBeenCalled();

    await TestRenderer.act(async () => {
      markFirstPaint();
      await flush();
    });
    // The stale (ASSETS) deferred run is cancelled; only NEXT is built.
    expect(ensureIndex).toHaveBeenCalledWith(NEXT);
    for (const call of ensureIndex.mock.calls) expect(call[0]).toBe(NEXT);
  });
});
