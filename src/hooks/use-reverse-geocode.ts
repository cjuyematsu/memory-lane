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

export function useReverseGeocode(coords: Coords | null): string | null {
  const [name, setName] = useState<string | null>(() =>
    coords ? cache.get(keyFor(coords)) ?? null : null
  );

  useEffect(() => {
    if (!coords) {
      setName(null);
      return;
    }
    let cancelled = false;
    lookup(coords).then((n) => {
      if (!cancelled) setName(n);
    });
    return () => {
      cancelled = true;
    };
  }, [coords?.latitude, coords?.longitude]);

  return name;
}
