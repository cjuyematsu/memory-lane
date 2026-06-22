import { shouldGreet } from '@/lib/nearby-greeting';

const base = {
  count: 3,
  inCooldown: false,
  bannerActive: false,
  hasPendingCluster: false,
};

describe('shouldGreet', () => {
  it('greets when there are nearby memories and nothing blocks it', () => {
    expect(shouldGreet(base)).toBe(true);
    expect(shouldGreet({ ...base, count: 1 })).toBe(true);
  });

  it('does not greet with no nearby memories', () => {
    expect(shouldGreet({ ...base, count: 0 })).toBe(false);
  });

  it('does not greet while in cooldown', () => {
    expect(shouldGreet({ ...base, inCooldown: true })).toBe(false);
  });

  it('does not greet while another banner is showing', () => {
    expect(shouldGreet({ ...base, bannerActive: true })).toBe(false);
  });

  it('does not greet when arriving via a notification tap', () => {
    expect(shouldGreet({ ...base, hasPendingCluster: true })).toBe(false);
  });
});
