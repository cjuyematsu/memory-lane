import { CRITICAL_DISK_BYTES, isCriticalSpace } from '@/lib/disk-space';

const GB = 1024 * 1024 * 1024;

describe('isCriticalSpace', () => {
  it('flags space under the threshold', () => {
    expect(isCriticalSpace(0.85 * GB)).toBe(true);
    expect(isCriticalSpace(0)).toBe(true);
  });

  it('passes space at or above the threshold', () => {
    expect(isCriticalSpace(CRITICAL_DISK_BYTES)).toBe(false);
    expect(isCriticalSpace(5 * GB)).toBe(false);
  });

  it('never claims full on junk input', () => {
    expect(isCriticalSpace(null)).toBe(false);
    expect(isCriticalSpace(undefined)).toBe(false);
    expect(isCriticalSpace(Number.NaN)).toBe(false);
    expect(isCriticalSpace(-1)).toBe(false);
  });

  it('honors a custom threshold', () => {
    expect(isCriticalSpace(1.5 * GB, 2 * GB)).toBe(true);
    expect(isCriticalSpace(2.5 * GB, 2 * GB)).toBe(false);
  });
});
