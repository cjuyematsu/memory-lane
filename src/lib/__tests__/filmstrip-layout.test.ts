import {
  FILMSTRIP_PAD_H,
  THUMB_SIZE,
  THUMB_STRIDE,
  filmCenterOffset,
  filmInitialScrollIndex,
} from '@/lib/filmstrip-layout';

const SCREEN_W = 393;

describe('filmCenterOffset', () => {
  it('clamps to 0 near the strip start', () => {
    expect(filmCenterOffset(0, SCREEN_W)).toBe(0);
    expect(filmCenterOffset(1, SCREEN_W)).toBe(0);
  });

  it('centers a deep thumb under the screen midline', () => {
    const i = 200;
    const offset = filmCenterOffset(i, SCREEN_W);
    const thumbCenter = FILMSTRIP_PAD_H + i * THUMB_STRIDE + THUMB_SIZE / 2;
    expect(thumbCenter - offset).toBeCloseTo(SCREEN_W / 2);
  });
});

describe('filmInitialScrollIndex', () => {
  it('is 0 when the strip opens clamped at its start', () => {
    expect(filmInitialScrollIndex(0, SCREEN_W, 500)).toBe(0);
    expect(filmInitialScrollIndex(1, SCREEN_W, 500)).toBe(0);
  });

  it('is the first visible thumb for a deep open (render region covers the viewport)', () => {
    const start = 200;
    const first = filmInitialScrollIndex(start, SCREEN_W, 500);
    // The first visible thumb sits at or left of the viewport's left edge…
    const offset = filmCenterOffset(start, SCREEN_W);
    expect(FILMSTRIP_PAD_H + first * THUMB_STRIDE).toBeLessThanOrEqual(offset + THUMB_STRIDE);
    // …and lies a half-screen of thumbs before the centered one.
    expect(first).toBeLessThan(start);
    expect(start - first).toBeLessThanOrEqual(Math.ceil(SCREEN_W / 2 / THUMB_STRIDE) + 1);
  });

  it('clamps to the last item so VirtualizedList never warns', () => {
    expect(filmInitialScrollIndex(499, SCREEN_W, 500)).toBeLessThanOrEqual(499);
    expect(filmInitialScrollIndex(10, SCREEN_W, 5)).toBeLessThanOrEqual(4);
    expect(filmInitialScrollIndex(10, SCREEN_W, 5)).toBeGreaterThanOrEqual(0);
  });

  it('never goes negative on tiny lists', () => {
    expect(filmInitialScrollIndex(0, SCREEN_W, 1)).toBe(0);
  });
});
