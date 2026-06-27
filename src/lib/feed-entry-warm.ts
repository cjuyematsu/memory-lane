import { useEffect, useState } from 'react';

// Cross-tree handoff for the onboarding "warm the first feed photo" path. The
// onboarding prewarm (components/onboarding/onboarding-flow.tsx) picks the photo
// the Camera Roll will open on — the same on-device entry the feed itself would
// pick — and stashes its id here while the user finishes tapping through. Two
// readers consume it:
//   1. FeedEntryWarmHost (root-mounted in app/_layout.tsx) decodes that photo
//      off-screen at the feed's exact frame size, so its result lands in the
//      expo-image cache entry the feed card will read (the cache key is
//      size-specific — a plain Image.prefetch can't populate it).
//   2. The feed's entry effect (components/feed/feed.tsx) prefers this id over a
//      fresh random probe, so it opens on exactly the warmed photo → cache hit →
//      no loading-polaroid beat on the onboarding → app handoff.
// Module-level (resets per launch) and only ever set during onboarding, so every
// normal cold launch sees `null` here and is unaffected. Same hand-rolled
// module-var + Set<subscriber> + useXxx hook pattern as lib/pending-cluster.ts.

let warmedEntryId: string | null = null;
const subscribers = new Set<() => void>();

export function setWarmedEntryId(id: string | null): void {
  if (warmedEntryId === id) return;
  warmedEntryId = id;
  for (const fn of subscribers) fn();
}

/** Synchronous read — used by the feed's entry effect to adopt the warmed photo. */
export function getWarmedEntryId(): string | null {
  return warmedEntryId;
}

/** Reactive read — used by the warm host so it mounts once onboarding sets the id. */
export function useWarmedEntryId(): string | null {
  const [id, setId] = useState(warmedEntryId);
  useEffect(() => {
    const sync = () => setId(warmedEntryId);
    subscribers.add(sync);
    // Catch a value set between this hook's render and effect run.
    sync();
    return () => {
      subscribers.delete(sync);
    };
  }, []);
  return id;
}

// Test-only: subscribe to changes (mirrors what useWarmedEntryId does) and reset
// module state so suites don't leak across each other.
export function __subscribeWarmedEntryForTests(fn: () => void): () => void {
  subscribers.add(fn);
  return () => {
    subscribers.delete(fn);
  };
}

export function __resetWarmedEntryForTests(): void {
  warmedEntryId = null;
  subscribers.clear();
}
