// Decode-burst latch: Near Me marks a short window whenever it adopts a grid
// snapshot, because that adoption fans out a dozen simultaneous ph:// image
// decodes (PHImageManager requests). The located-index sweep reads the latch
// and down-shifts (fewer concurrent native reads, checkpoint writes deferred)
// so the two never peak together — the June 30 field crash profile was exactly
// this collision: warm launch, GPS fix landing at ~8s, grid populate + delta
// sweep + sync checkpoint stringify stacking into a jetsam on an iPhone 12.
// Same module-latch pattern as first-paint.ts; no React, no subscribers needed
// (the sweep polls per batch).

export const DECODE_BURST_MS = 10000;

let burstUntil = 0;

/**
 * Open (or extend) the burst window. Repeated marks extend to the furthest
 * deadline, never shorten it.
 */
export function markDecodeBurst(durationMs: number = DECODE_BURST_MS, now: number = Date.now()): void {
  burstUntil = Math.max(burstUntil, now + durationMs);
}

/** True while grid decodes are (probably) still in flight. */
export function isDecodeBurstActive(now: number = Date.now()): boolean {
  return now < burstUntil;
}

// Test-only: reset the latch so suites don't leak state across each other.
export function __resetDecodeBurstForTests(): void {
  burstUntil = 0;
}
