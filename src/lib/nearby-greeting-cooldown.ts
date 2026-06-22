import { createLocationCooldown } from '@/lib/location-cooldown';

// The "N memories near you" app-open banner is a gentle reminder, so it gets a
// long 24h cooldown per place: open the app repeatedly at the same spot and you
// only see it once a day. Its own file keeps it independent of the 6h geofence
// notification cooldown.
export const { isInCooldown, markNotified } = createLocationCooldown({
  file: 'nearby-greeting-cooldown.json',
  windowMs: 24 * 60 * 60 * 1000,
  radiusM: 150,
});
