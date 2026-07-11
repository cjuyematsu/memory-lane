import { parseOnboardingState } from '@/hooks/use-onboarding';

// The hook module pulls in persisted-file (expo-file-system) at the top level;
// parseOnboardingState touches none of it. Mirrors use-located-assets.test.ts.
jest.mock('@/lib/persisted-file', () => ({
  persistedFile: jest.fn(),
  readPersisted: jest.fn(),
}));

const DEFAULTS = { completed: false, started: false, step: 0 };

describe('parseOnboardingState', () => {
  it('returns defaults for null, junk text, and non-object JSON', () => {
    expect(parseOnboardingState(null)).toEqual(DEFAULTS);
    expect(parseOnboardingState('}{')).toEqual(DEFAULTS);
    expect(parseOnboardingState('[]')).toEqual(DEFAULTS);
    expect(parseOnboardingState('"done"')).toEqual(DEFAULTS);
  });

  it('round-trips valid state', () => {
    const s = { completed: true, started: true, step: 4 };
    expect(parseOnboardingState(JSON.stringify(s))).toEqual(s);
  });

  it('falls back per-field on wrong types', () => {
    expect(
      parseOnboardingState(JSON.stringify({ completed: 'yes', started: true, step: 2 }))
    ).toEqual({ completed: false, started: true, step: 2 });
    expect(parseOnboardingState(JSON.stringify({ completed: true, started: 1 }))).toEqual({
      completed: true,
      started: false,
      step: 0,
    });
  });

  it('rejects negative, fractional, and non-number steps (a garbage resume seed)', () => {
    expect(parseOnboardingState(JSON.stringify({ step: -1 })).step).toBe(0);
    expect(parseOnboardingState(JSON.stringify({ step: 2.5 })).step).toBe(0);
    expect(parseOnboardingState(JSON.stringify({ step: '3' })).step).toBe(0);
    expect(parseOnboardingState(JSON.stringify({ step: null })).step).toBe(0);
  });
});
