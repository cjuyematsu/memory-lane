// First-paint latch: a one-shot signal the Camera Roll feed flips the first time
// a photo actually renders. The cold-start located-index sweep waits on this so
// the user sees a photo before the bulk metadata work begins — get something on
// screen first, then do background work. Same hand-rolled module pattern as the
// rest of the app (pending-cluster, near-me-request): a module flag + a set of
// waiters, no state library.

let painted = false;
const waiters = new Set<() => void>();

/** Flip the latch (idempotent). Called by the feed when its first card paints. */
export function markFirstPaint(): void {
  if (painted) return;
  painted = true;
  const fns = [...waiters];
  waiters.clear();
  for (const fn of fns) fn();
}

/** Synchronous read — true once the feed has painted at least one photo. */
export function hasFirstPainted(): boolean {
  return painted;
}

/**
 * Resolve once the feed has painted, or after `timeoutMs` as a fallback — so a
 * library that never paints (empty, or a stuck first photo) can't block the
 * index build forever.
 */
export function whenFirstPaint(timeoutMs: number): Promise<void> {
  if (painted) return Promise.resolve();
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      waiters.delete(finish);
      resolve();
    };
    const timer = setTimeout(finish, timeoutMs);
    waiters.add(finish);
  });
}

// Test-only: reset the latch so suites don't leak state across each other.
export function __resetFirstPaintForTests(): void {
  painted = false;
  waiters.clear();
}
