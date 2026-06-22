import type { LocationGeocodedAddress } from 'expo-location';

import { pickPlaceName } from '@/hooks/use-reverse-geocode';

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
