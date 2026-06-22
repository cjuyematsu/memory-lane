import { createLocationCooldown } from '@/lib/location-cooldown';

// After notifying about a place, stay quiet within 150m of it for 6 hours. 150m
// is large enough to avoid re-pinging the same spot (and its adjacent ~50m
// clusters), small enough that distinct places — e.g. different buildings on a
// campus — still each get their own notification. Tune here.
export const { isInCooldown, markNotified } = createLocationCooldown({
  file: 'notification-cooldown.json',
  windowMs: 6 * 60 * 60 * 1000,
  radiusM: 150,
});
