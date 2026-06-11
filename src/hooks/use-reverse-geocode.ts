import { useEffect, useState } from 'react';
import * as Location from 'expo-location';

type Coords = { latitude: number; longitude: number };

const cache = new Map<string, string | null>();
const inflight = new Map<string, Promise<string | null>>();

function keyFor({ latitude, longitude }: Coords) {
  return `${latitude.toFixed(3)},${longitude.toFixed(3)}`;
}

function pickPlaceName(addr: Location.LocationGeocodedAddress): string | null {
  if (addr.name && /\p{L}/u.test(addr.name)) return addr.name;
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

  const p = (async () => {
    try {
      const results = await Location.reverseGeocodeAsync(coords);
      const first = results[0];
      const name = first ? pickPlaceName(first) : null;
      cache.set(key, name);
      return name;
    } catch {
      cache.set(key, null);
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
    lookup(target).then((n) => {
      if (!cancelled) setLooked({ key: k, name: n });
    });
    return () => {
      cancelled = true;
    };
  }, [lat, lng]);

  if (key == null) return null;
  if (cache.has(key)) return cache.get(key) ?? null;
  return looked?.key === key ? looked.name : null;
}
