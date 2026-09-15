// The demo location override is the only thing in the app allowed to lie about
// where the phone is, so both of its guards are worth proving rather than
// assuming: (1) the build-time kill switch, which is what keeps demo mode out of
// a store binary, and (2) coordinate validation, because a NaN or out-of-range
// lat/lng would flow straight into distanceMeters and silently break every
// radius comparison in the app (NaN comparisons are always false, so nothing
// would ever be "nearby" and nothing would ever be "in cooldown").
import {
  demoCoordsFor,
  isValidCoords,
  parseDemoMode,
  type DemoModeState,
} from '@/lib/demo-mode';

jest.mock('expo-file-system', () => ({
  File: class {},
  Paths: { cache: '/cache', document: '/doc' },
}));
jest.mock('expo-location', () => ({
  getCurrentPositionAsync: jest.fn(),
  getLastKnownPositionAsync: jest.fn(),
}));

const SF = { latitude: 37.7749, longitude: -122.4194 };

describe('isValidCoords', () => {
  it('accepts an in-range pair', () => {
    expect(isValidCoords(SF)).toBe(true);
    expect(isValidCoords({ latitude: 0, longitude: 0 })).toBe(true);
    expect(isValidCoords({ latitude: -90, longitude: 180 })).toBe(true);
  });

  it('rejects non-finite, out-of-range, wrong-typed, and missing values', () => {
    expect(isValidCoords({ latitude: Number.NaN, longitude: 0 })).toBe(false);
    expect(isValidCoords({ latitude: 0, longitude: Number.NaN })).toBe(false);
    expect(isValidCoords({ latitude: Infinity, longitude: 0 })).toBe(false);
    expect(isValidCoords({ latitude: 91, longitude: 0 })).toBe(false);
    expect(isValidCoords({ latitude: 0, longitude: -181 })).toBe(false);
    expect(isValidCoords({ latitude: '37.7', longitude: -122 })).toBe(false);
    expect(isValidCoords({ latitude: 37.7 })).toBe(false);
    expect(isValidCoords(null)).toBe(false);
    expect(isValidCoords(undefined)).toBe(false);
    expect(isValidCoords('37.7,-122')).toBe(false);
    expect(isValidCoords([37.7, -122])).toBe(false);
  });
});

describe('parseDemoMode', () => {
  it('round-trips a valid state', () => {
    const out = parseDemoMode(
      JSON.stringify({ enabled: true, coords: SF, label: '4 photos' })
    );
    expect(out).toEqual({ enabled: true, coords: SF, label: '4 photos' });
  });

  it('defaults to off for a missing file', () => {
    expect(parseDemoMode(null)).toEqual({ enabled: false, coords: null, label: null });
  });

  it('collapses enabled to false when the coordinate is unusable', () => {
    // Enabled-without-coords is meaningless and dangerous: callers read
    // `enabled` and expect a coordinate to be there.
    for (const coords of [
      undefined,
      null,
      { latitude: Number.NaN, longitude: 0 },
      { latitude: 1e999, longitude: 0 },
      { latitude: 200, longitude: 0 },
      { latitude: '1', longitude: '2' },
      'somewhere',
    ]) {
      const out = parseDemoMode(JSON.stringify({ enabled: true, coords }));
      expect(out.enabled).toBe(false);
      expect(out.coords).toBeNull();
    }
  });

  it('keeps a valid coordinate even when the override is off', () => {
    const out = parseDemoMode(JSON.stringify({ enabled: false, coords: SF }));
    expect(out.enabled).toBe(false);
    expect(out.coords).toEqual(SF);
  });

  it('drops a wrong-typed label rather than surfacing it', () => {
    const out = parseDemoMode(JSON.stringify({ enabled: true, coords: SF, label: 7 }));
    expect(out.label).toBeNull();
  });

  it('treats a truthy-but-not-true enabled as off', () => {
    const out = parseDemoMode(JSON.stringify({ enabled: 'yes', coords: SF }));
    expect(out.enabled).toBe(false);
  });
});

describe('demoCoordsFor (the kill switch)', () => {
  const on: DemoModeState = { enabled: true, coords: SF, label: null };

  it('returns null whenever the build switch is off, whatever the state says', () => {
    // This is the guarantee that matters for a store build: no persisted file,
    // however it got onto the device, can turn the override on.
    expect(demoCoordsFor(on, false)).toBeNull();
    expect(demoCoordsFor({ enabled: false, coords: SF, label: null }, false)).toBeNull();
    expect(demoCoordsFor(null, false)).toBeNull();
  });

  it('returns null when the build is enabled but the state is not', () => {
    expect(demoCoordsFor(null, true)).toBeNull();
    expect(demoCoordsFor({ enabled: false, coords: SF, label: null }, true)).toBeNull();
  });

  it('returns null when enabled but the coordinate is missing or invalid', () => {
    expect(demoCoordsFor({ enabled: true, coords: null, label: null }, true)).toBeNull();
    expect(
      demoCoordsFor(
        { enabled: true, coords: { latitude: Number.NaN, longitude: 0 }, label: null },
        true
      )
    ).toBeNull();
  });

  it('returns the coordinate only when the build and the state both agree', () => {
    expect(demoCoordsFor(on, true)).toEqual(SF);
  });
});
