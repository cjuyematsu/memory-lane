import { parseNotificationSettings } from '@/hooks/use-notification-settings';
import { PLACE_COOLDOWN_DEFAULT_MS } from '@/lib/place-cooldown';

// The hook module pulls in persisted-file (expo-file-system) at the top level;
// parseNotificationSettings touches none of it. Mirrors use-located-assets.test.ts.
jest.mock('@/lib/persisted-file', () => ({
  persistedFile: jest.fn(),
  readPersisted: jest.fn(),
}));

const DEFAULTS = { enabled: false, placeCooldownMs: PLACE_COOLDOWN_DEFAULT_MS };

describe('parseNotificationSettings', () => {
  it('returns defaults for null, junk text, and non-object JSON', () => {
    expect(parseNotificationSettings(null)).toEqual(DEFAULTS);
    expect(parseNotificationSettings('not json {')).toEqual(DEFAULTS);
    expect(parseNotificationSettings('[1,2]')).toEqual(DEFAULTS);
    expect(parseNotificationSettings('42')).toEqual(DEFAULTS);
    expect(parseNotificationSettings('null')).toEqual(DEFAULTS);
  });

  it('round-trips valid settings', () => {
    const s = { enabled: true, placeCooldownMs: 86400000 };
    expect(parseNotificationSettings(JSON.stringify(s))).toEqual(s);
  });

  it('preserves the explicit-null "Only once" cooldown', () => {
    const s = { enabled: true, placeCooldownMs: null };
    expect(parseNotificationSettings(JSON.stringify(s))).toEqual(s);
  });

  it('falls back per-field on wrong types without touching valid fields', () => {
    expect(parseNotificationSettings(JSON.stringify({ enabled: 'yes', placeCooldownMs: 5 })))
      .toEqual({ enabled: false, placeCooldownMs: 5 });
    expect(parseNotificationSettings(JSON.stringify({ enabled: true, placeCooldownMs: '90d' })))
      .toEqual({ enabled: true, placeCooldownMs: PLACE_COOLDOWN_DEFAULT_MS });
  });

  it('rejects NaN, zero, and negative cooldowns (the NaN one silently killed the cooldown gate)', () => {
    // NaN doesn't survive JSON round-trips, so feed it as a raw string too.
    expect(parseNotificationSettings('{"placeCooldownMs": NaN}')).toEqual(DEFAULTS);
    expect(parseNotificationSettings(JSON.stringify({ placeCooldownMs: 0 }))).toEqual(DEFAULTS);
    expect(parseNotificationSettings(JSON.stringify({ placeCooldownMs: -5 }))).toEqual(DEFAULTS);
    // JSON.parse turns the 1e999 literal into Infinity (note JSON.stringify of
    // Infinity would instead produce null, the legit "Only once" value).
    expect(parseNotificationSettings('{"placeCooldownMs": 1e999}')).toEqual(DEFAULTS);
  });

  it('ignores unknown extra fields from newer builds', () => {
    expect(
      parseNotificationSettings(JSON.stringify({ enabled: true, futureFlag: 'x' }))
    ).toEqual({ enabled: true, placeCooldownMs: PLACE_COOLDOWN_DEFAULT_MS });
  });

  it('a missing placeCooldownMs key gets the default (not null)', () => {
    expect(parseNotificationSettings(JSON.stringify({ enabled: true }))).toEqual({
      enabled: true,
      placeCooldownMs: PLACE_COOLDOWN_DEFAULT_MS,
    });
  });
});
