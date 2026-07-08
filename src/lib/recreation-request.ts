import { useEffect, useState } from 'react';

import { type Asset } from 'expo-media-library';

import { type AssetLocation } from '@/hooks/use-asset-metadata';

// Bridges the Recreate buttons (feed + Near Me viewer) to the root-mounted
// RecreationHost overlay, following the module-pub/sub convention used by
// `pending-cluster.ts` / `share-memory.ts`. The host opens the camera-with-
// ghost flow for the requested asset.

// The old photo to recreate plus what the caller already knows about it, so
// the camera screen can show its caption/distance hint without a fresh native
// read (missing fields are backfilled lazily from the metadata cache).
export type RecreationTarget = {
  asset: Asset;
  creationTime: number | null;
  location: AssetLocation | null;
};

let target: RecreationTarget | null = null;
const subscribers = new Set<() => void>();

function notify() {
  for (const fn of subscribers) fn();
}

export function requestRecreation(t: RecreationTarget): void {
  target = t;
  notify();
}

export function closeRecreation(): void {
  if (!target) return;
  target = null;
  notify();
}

// Direct store subscription for callers that react to changes with their own
// state — setState belongs in the callback, not in an effect watching the
// hook value. Returns the unsubscribe function.
export function subscribeRecreation(cb: (t: RecreationTarget | null) => void): () => void {
  const fn = () => cb(target);
  subscribers.add(fn);
  return () => {
    subscribers.delete(fn);
  };
}

export function useRecreationTarget(): RecreationTarget | null {
  const [t, setT] = useState<RecreationTarget | null>(target);
  useEffect(() => {
    const fn = () => setT(target);
    subscribers.add(fn);
    return () => {
      subscribers.delete(fn);
    };
  }, []);
  return t;
}
