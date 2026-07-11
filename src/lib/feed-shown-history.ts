// Ring of the most recently SHOWN feed photos, so no shuffle vector can
// re-surface a photo the user just saw. The feed had no shown-history at all:
// once a photo left the shuffle queue nothing stopped the random sampler, the
// old-memory pool, or a stale-residency re-download from bringing it straight
// back ("got the same photo from 3 years ago 3 times"). Every sampler consults
// this ring; recording happens wherever currentId lands on a new photo (shuffle
// commits, swipes, find-on-device jumps). Module-level, session-scoped — same
// pattern as decode-burst.ts.

export const SHOWN_HISTORY_CAP = 40;
// Below this library size the skip is disabled: excluding 40 of, say, 60
// photos would starve the samplers' bounded retry loops for no real benefit
// (small libraries repeat soon regardless).
export const SHOWN_HISTORY_MIN_LIBRARY = SHOWN_HISTORY_CAP * 3;

let ring: string[] = [];

/** Record a shown photo (move-to-end dedupe, capped). */
export function markShown(id: string): void {
  const at = ring.indexOf(id);
  if (at >= 0) ring.splice(at, 1);
  ring.push(id);
  if (ring.length > SHOWN_HISTORY_CAP) ring.splice(0, ring.length - SHOWN_HISTORY_CAP);
}

/**
 * True when a sampler should pass over this id: it was shown recently AND the
 * library is large enough that skipping can't starve the sampler. Callers use
 * this inside bounded retry loops that keep their existing fallbacks, so a
 * pathological case degrades to today's behavior, never to a stall.
 */
export function shouldSkipShown(id: string, libraryTotal: number): boolean {
  if (libraryTotal < SHOWN_HISTORY_MIN_LIBRARY) return false;
  return ring.includes(id);
}

// Test-only: reset so suites don't leak state across each other.
export function __resetShownHistoryForTests(): void {
  ring = [];
}
