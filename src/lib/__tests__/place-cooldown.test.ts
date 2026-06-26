import {
  DAY_MS,
  describeCooldown,
  PLACE_COOLDOWN_DEFAULT_MS,
  PLACE_COOLDOWN_OPTIONS,
} from '@/lib/place-cooldown';

describe('place cooldown options', () => {
  it('keeps the shipped default at ~90 days', () => {
    expect(PLACE_COOLDOWN_DEFAULT_MS).toBe(90 * DAY_MS);
  });

  it('offers the default as a selectable option', () => {
    const labels = PLACE_COOLDOWN_OPTIONS.map((o) => o.ms);
    expect(labels).toContain(PLACE_COOLDOWN_DEFAULT_MS);
  });

  it('includes an indefinite ("Only once") option as null', () => {
    const once = PLACE_COOLDOWN_OPTIONS.find((o) => o.ms === null);
    expect(once).toBeDefined();
    expect(once?.label).toBe('Only once');
  });

  it('keeps the options ascending (real durations before "Only once")', () => {
    const durations = PLACE_COOLDOWN_OPTIONS.filter((o) => o.ms != null).map((o) => o.ms as number);
    const sorted = [...durations].sort((a, b) => a - b);
    expect(durations).toEqual(sorted);
    // "Only once" is the last, widest choice.
    expect(PLACE_COOLDOWN_OPTIONS[PLACE_COOLDOWN_OPTIONS.length - 1].ms).toBeNull();
  });

  it('describes each option by its own label', () => {
    for (const opt of PLACE_COOLDOWN_OPTIONS) {
      expect(describeCooldown(opt.ms)).toBe(opt.label);
    }
  });

  it('describes the indefinite value as "Only once"', () => {
    expect(describeCooldown(null)).toBe('Only once');
  });

  it('falls back to the default label for an unknown value', () => {
    expect(describeCooldown(12345)).toBe('3 months');
  });
});
