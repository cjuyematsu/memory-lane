import { distanceMeters, formatDistanceHint, formatDistanceShort } from '@/utils/distance';

describe('formatDistanceHint', () => {
  it('returns null when there is no distance to report', () => {
    expect(formatDistanceHint(null)).toBeNull();
    expect(formatDistanceHint(Number.NaN)).toBeNull();
    expect(formatDistanceHint(-5)).toBeNull();
  });

  it('says "same spot" under 50 m', () => {
    expect(formatDistanceHint(0)).toBe('Same spot');
    expect(formatDistanceHint(10)).toBe('Same spot');
    expect(formatDistanceHint(49)).toBe('Same spot');
  });

  it('rounds meters to the nearest 10 from 50 m up', () => {
    expect(formatDistanceHint(50)).toBe('50 m from the original');
    expect(formatDistanceHint(51)).toBe('50 m from the original');
    expect(formatDistanceHint(484)).toBe('480 m from the original');
    expect(formatDistanceHint(486)).toBe('490 m from the original');
  });

  it('switches to kilometers when the rounded distance reaches 1000 m', () => {
    expect(formatDistanceHint(995)).toBe('1 km from the original');
    expect(formatDistanceHint(1234)).toBe('1.2 km from the original');
  });

  it('drops the decimal for whole kilometers and everything past 10 km', () => {
    expect(formatDistanceHint(2000)).toBe('2 km from the original');
    expect(formatDistanceHint(15680)).toBe('16 km from the original');
    expect(formatDistanceHint(1608200)).toBe('1608 km from the original');
  });
});

describe('formatDistanceShort', () => {
  it('mirrors the hint banding in compact form', () => {
    expect(formatDistanceShort(null)).toBeNull();
    expect(formatDistanceShort(-1)).toBeNull();
    expect(formatDistanceShort(10)).toBe('same spot');
    expect(formatDistanceShort(51)).toBe('50 m away');
    expect(formatDistanceShort(995)).toBe('1 km away');
    expect(formatDistanceShort(1234)).toBe('1.2 km away');
    expect(formatDistanceShort(2000)).toBe('2 km away');
    expect(formatDistanceShort(1608200)).toBe('1608 km away');
  });
});

describe('distanceMeters', () => {
  it('is zero for identical coordinates', () => {
    const p = { latitude: 34.05, longitude: -118.24 };
    expect(distanceMeters(p, p)).toBe(0);
  });

  it('measures ~111 km per degree of latitude', () => {
    const a = { latitude: 34, longitude: -118 };
    const b = { latitude: 35, longitude: -118 };
    expect(distanceMeters(a, b)).toBeGreaterThan(110_000);
    expect(distanceMeters(a, b)).toBeLessThan(112_000);
  });
});
