import {
  __resetDecodeBurstForTests,
  DECODE_BURST_MS,
  isDecodeBurstActive,
  markDecodeBurst,
} from '@/lib/decode-burst';

describe('decode-burst', () => {
  beforeEach(() => __resetDecodeBurstForTests());

  it('is inactive before any mark', () => {
    expect(isDecodeBurstActive(1000)).toBe(false);
  });

  it('is active for the window after a mark, then expires', () => {
    markDecodeBurst(DECODE_BURST_MS, 1000);
    expect(isDecodeBurstActive(1000)).toBe(true);
    expect(isDecodeBurstActive(1000 + DECODE_BURST_MS - 1)).toBe(true);
    expect(isDecodeBurstActive(1000 + DECODE_BURST_MS)).toBe(false);
  });

  it('re-marking extends the deadline', () => {
    markDecodeBurst(DECODE_BURST_MS, 1000);
    markDecodeBurst(DECODE_BURST_MS, 5000);
    expect(isDecodeBurstActive(5000 + DECODE_BURST_MS - 1)).toBe(true);
  });

  it('a later mark never shortens an earlier, longer deadline', () => {
    markDecodeBurst(60000, 1000);
    markDecodeBurst(1, 2000);
    expect(isDecodeBurstActive(30000)).toBe(true);
  });
});
