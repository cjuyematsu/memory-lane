import * as Location from 'expo-location';
import type { LocationGeocodedAddress } from 'expo-location';

import { pickPlaceName, prefetchReverseGeocode } from '@/hooks/use-reverse-geocode';

jest.mock('expo-location', () => ({
  reverseGeocodeAsync: jest.fn(),
}));

// Build a full address with everything null but the given overrides, so each
// case isolates exactly the fields under test.
function addr(partial: Partial<LocationGeocodedAddress>): LocationGeocodedAddress {
  return {
    city: null,
    district: null,
    streetNumber: null,
    street: null,
    region: null,
    subregion: null,
    country: null,
    postalCode: null,
    name: null,
    isoCountryCode: null,
    timezone: null,
    formattedAddress: null,
    ...partial,
  };
}

describe('pickPlaceName', () => {
  it('keeps an evocative placemark / POI name', () => {
    expect(
      pickPlaceName(addr({ name: 'Pike Place Market', city: 'Seattle' }))
    ).toBe('Pike Place Market');
  });

  it('falls back to the city for a numbered residential street address', () => {
    expect(
      pickPlaceName(
        addr({
          name: '16923 NE 122nd St',
          streetNumber: '16923',
          street: 'NE 122nd St',
          district: 'Wedgwood',
          city: 'Seattle',
        })
      )
    ).toBe('Seattle');
  });

  it('detects a house-numbered name even when streetNumber is missing', () => {
    expect(
      pickPlaceName(addr({ name: '742 Evergreen Terrace', city: 'Springfield' }))
    ).toBe('Springfield');
  });

  it('does not treat a numbered street name without a house number as an address', () => {
    // "NE 122nd St" starts with a letter, so it is the geocoder's area label,
    // not a specific home — keep it.
    expect(pickPlaceName(addr({ name: 'NE 122nd St', city: 'Seattle' }))).toBe(
      'NE 122nd St'
    );
  });

  it('walks the fallback chain when no city is known', () => {
    expect(
      pickPlaceName(addr({ name: '1 Main St', streetNumber: '1', subregion: 'King County' }))
    ).toBe('King County');
    expect(pickPlaceName(addr({ region: 'Washington' }))).toBe('Washington');
    expect(pickPlaceName(addr({ country: 'United States' }))).toBe('United States');
  });

  it('returns null when nothing usable is present', () => {
    expect(pickPlaceName(addr({}))).toBeNull();
    expect(pickPlaceName(addr({ name: '12345' }))).toBeNull();
  });
});

// The failure-handling contract of the module lookup (via prefetch, the
// non-React entry): a FAILED geocode must never poison the coordinate-bucket
// cache for the session, but re-attempts are throttled so retries can't
// hammer Apple's rate limiter. Coordinates are distinct per test — the
// module cache is shared state.
describe('reverse-geocode failure handling', () => {
  const geocode = jest.mocked(Location.reverseGeocodeAsync);
  const flush = () => new Promise((r) => setTimeout(r, 0));

  beforeEach(() => {
    geocode.mockReset();
  });

  it('does not cache a failure, throttles retries, then recovers', async () => {
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
    const coords = { latitude: 10.001, longitude: 20.001 };

    geocode.mockRejectedValueOnce(new Error('rate limited'));
    prefetchReverseGeocode(coords);
    await flush();
    expect(geocode).toHaveBeenCalledTimes(1);

    // Inside the throttle window: short-circuits without a native call.
    prefetchReverseGeocode(coords);
    await flush();
    expect(geocode).toHaveBeenCalledTimes(1);

    // Past the window: the same bucket is retried (NOT poisoned by the
    // failure), and this success is cached.
    nowSpy.mockReturnValue(1_000_000 + 9_000);
    geocode.mockResolvedValueOnce([addr({ name: 'Pike Place Market' })]);
    prefetchReverseGeocode(coords);
    await flush();
    expect(geocode).toHaveBeenCalledTimes(2);

    // Cached now — no further native calls, even past another window.
    nowSpy.mockReturnValue(1_000_000 + 60_000);
    prefetchReverseGeocode(coords);
    await flush();
    expect(geocode).toHaveBeenCalledTimes(2);

    nowSpy.mockRestore();
  });

  it('caches a successful empty result as a real "no placemark" answer', async () => {
    const coords = { latitude: 30.002, longitude: 40.002 };
    geocode.mockResolvedValueOnce([]);
    prefetchReverseGeocode(coords);
    await flush();
    prefetchReverseGeocode(coords);
    await flush();
    expect(geocode).toHaveBeenCalledTimes(1);
  });
});
