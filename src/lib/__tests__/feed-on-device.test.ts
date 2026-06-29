import { nextOnDeviceIndex } from '@/lib/feed-on-device';

describe('nextOnDeviceIndex', () => {
  it('finds the nearest on-device photo forward of the current index', () => {
    const c = [
      { inCloud: false }, // 0 (current)
      { inCloud: true }, // 1
      { inCloud: false }, // 2
      { inCloud: false }, // 3
    ];
    expect(nextOnDeviceIndex(c, 0)).toBe(2);
  });

  it('wraps around when the only on-device photo is before the current index', () => {
    const c = [
      { inCloud: false }, // 0
      { inCloud: true }, // 1 (current)
      { inCloud: true }, // 2
    ];
    expect(nextOnDeviceIndex(c, 1)).toBe(0);
  });

  it('does not count never-probed (undefined) candidates', () => {
    const c = [
      { inCloud: true }, // 0 (current)
      { inCloud: undefined }, // 1
      { inCloud: undefined }, // 2
    ];
    expect(nextOnDeviceIndex(c, 0)).toBeNull();
  });

  it('returns null when every photo is offloaded', () => {
    const c = [{ inCloud: true }, { inCloud: true }, { inCloud: true }];
    expect(nextOnDeviceIndex(c, 0)).toBeNull();
  });

  it('never returns the current index even if it is the only on-device one', () => {
    const c = [{ inCloud: true }, { inCloud: false }, { inCloud: true }];
    // current is index 1 (the on-device one); searching forward finds no OTHER
    // on-device photo, so it returns null rather than pointing back at itself.
    expect(nextOnDeviceIndex(c, 1)).toBeNull();
  });
});
