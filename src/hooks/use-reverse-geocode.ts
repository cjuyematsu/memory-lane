import { useEffect, useState } from 'react';
import * as Location from 'expo-location';

type Coords = { latitude: number; longitude: number };

const cache = new Map<string, string | null>();
const inflight = new Map<string, Promise<string | null>>();
// Last failed lookup per key. A FAILED geocode is never written to `cache`
// (same rule as use-asset-metadata: caching a failure poisons the key — here
// for every photo in that ~100m bucket — for the whole session). Apple
// rate-limits reverseGeocodeAsync aggressively, and the feed's warm fan-out
// bursts several lookups at once, so transient failures are routine. This map
// only throttles re-attempts so retries can't hammer the geocoder.
const failedAt = new Map<string, number>();
/** After a failed lookup, further attempts for that key short-circuit for this
 *  long. Must be shorter than GEOCODE_RETRY_MS or the hook's retry would land
 *  inside the window and be a guaranteed no-op. */
const GEOCODE_RETRY_AFTER_MS = 8000;
/** Delay between the hook's bounded in-card retries after a failed lookup. */
const GEOCODE_RETRY_MS = 10000;

function keyFor({ latitude, longitude }: Coords) {
  return `${latitude.toFixed(3)},${longitude.toFixed(3)}`;
}

// A placemark/POI name ("Pike Place Market") makes a great caption, but a bare
// residential street address ("16923 NE 122nd St") is too precise — it can be
// someone's home and discourages sharing the caption — so for those we fall back
// to the city. A street address is detected by a leading house number (the
// geocoder's `name` starts with the streetNumber, or with bare digits).
export function pickPlaceName(addr: Location.LocationGeocodedAddress): string | null {
  const name = addr.name?.trim() ?? '';
  const startsWithHouseNumber =
    (!!addr.streetNumber && name.startsWith(addr.streetNumber)) || /^\d+\s/.test(name);
  if (name && /\p{L}/u.test(name) && !startsWithHouseNumber) return name;
  if (addr.city) return addr.city;
  if (addr.subregion) return addr.subregion;
  if (addr.region) return addr.region;
  if (addr.country) return addr.country;
  return null;
}

async function lookup(coords: Coords): Promise<string | null> {
  const key = keyFor(coords);
  if (cache.has(key)) return cache.get(key) ?? null;
  const existing = inflight.get(key);
  if (existing) return existing;
  const lastFail = failedAt.get(key);
  if (lastFail != null && Date.now() - lastFail < GEOCODE_RETRY_AFTER_MS) return null;

  const p = (async () => {
    try {
      const results = await Location.reverseGeocodeAsync(coords);
      const first = results[0];
      const name = first ? pickPlaceName(first) : null;
      // Only a completed geocode is cached — a legitimately empty result (no
      // placemark for these coords) is a real answer and caches as null.
      cache.set(key, name);
      failedAt.delete(key);
      return name;
    } catch {
      // Thrown lookup (rate-limited, offline): stay UNCACHED so it can be
      // retried, but stamp the failure so retries are throttled.
      failedAt.set(key, Date.now());
      return null;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, p);
  return p;
}

export function prefetchReverseGeocode(coords: Coords | null): void {
  if (!coords) return;
  lookup(coords).catch(() => {});
}

export function useReverseGeocode(coords: Coords | null): string | null {
  // The name is derived: straight from the cache when present, else from the
  // last completed lookup if it matches the current key. No state resets in
  // the effect body — switching coords just stops matching the stale result.
  const [looked, setLooked] = useState<{ key: string; name: string | null } | null>(
    null
  );
  const lat = coords?.latitude;
  const lng = coords?.longitude;
  const key = lat != null && lng != null ? keyFor({ latitude: lat, longitude: lng }) : null;

  useEffect(() => {
    if (lat == null || lng == null) return;
    const target = { latitude: lat, longitude: lng };
    const k = keyFor(target);
    if (cache.has(k)) return;
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;
    // Initial attempt + 2 bounded retries. A resolved lookup that did NOT
    // populate the cache was a failure (rate-limited/offline) — retry it after
    // the throttle window so the place can still pop in on the card the user
    // is looking at, instead of staying blank for the session.
    const maxAttempts = 3;
    const tryLookup = () => {
      lookup(target).then(() => {
        if (cancelled) return;
        if (cache.has(k)) {
          // Read the cache, not the resolved value: a throttled short-circuit
          // resolves null even when a parallel caller cached the real name.
          setLooked({ key: k, name: cache.get(k) ?? null });
          return;
        }
        attempt += 1;
        if (attempt < maxAttempts) retryTimer = setTimeout(tryLookup, GEOCODE_RETRY_MS);
      });
    };
    tryLookup();
    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [lat, lng]);

  if (key == null) return null;
  if (cache.has(key)) return cache.get(key) ?? null;
  return looked?.key === key ? looked.name : null;
}
