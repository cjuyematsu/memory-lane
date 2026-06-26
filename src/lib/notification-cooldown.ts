import { createLocationCooldown } from '@/lib/location-cooldown';

// After notifying about a place, stay quiet near it for 12 hours — a short
// spatial guard against a near-duplicate cluster double-pinging on one arrival.
// The geofence caller (`handleClusterEnter`) passes a density-adaptive radius
// (COOLDOWN_OPTS, ~100m floor) as the per-call override, so distinct places —
// e.g. different buildings on a campus — still each get their own notification;
// the long-term "don't repeat the same memory" job lives in cluster-cooldown.ts.
// The 150m default below is only the fallback when no override is given.
export const { isInCooldown, markNotified } = createLocationCooldown({
  file: 'notification-cooldown.json',
  windowMs: 12 * 60 * 60 * 1000,
  radiusM: 150,
});
