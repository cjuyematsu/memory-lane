import {
  shouldMigrateComplete,
  shouldShowOnboarding,
} from '@/lib/onboarding-decision';

describe('onboarding decision', () => {
  describe('shouldShowOnboarding', () => {
    it('shows the flow on a fresh install (not started, photos not granted)', () => {
      expect(
        shouldShowOnboarding({ completed: false, started: false, mediaGranted: false })
      ).toBe(true);
    });

    it('keeps showing a new user who started and granted photos then closed', () => {
      expect(
        shouldShowOnboarding({ completed: false, started: true, mediaGranted: true })
      ).toBe(true);
    });

    it('does not show an existing user (not started) who already has photos', () => {
      expect(
        shouldShowOnboarding({ completed: false, started: false, mediaGranted: true })
      ).toBe(false);
    });

    it('does not show once completed', () => {
      expect(
        shouldShowOnboarding({ completed: true, started: true, mediaGranted: true })
      ).toBe(false);
      expect(
        shouldShowOnboarding({ completed: true, started: false, mediaGranted: false })
      ).toBe(false);
    });
  });

  describe('shouldMigrateComplete', () => {
    it('migrates an existing user: photos granted, never started, not completed', () => {
      expect(
        shouldMigrateComplete({ completed: false, started: false, mediaGranted: true })
      ).toBe(true);
    });

    it('does NOT migrate a new user mid-onboarding who granted photos then closed', () => {
      expect(
        shouldMigrateComplete({ completed: false, started: true, mediaGranted: true })
      ).toBe(false);
    });

    it('does not migrate a fresh install with no photo access', () => {
      expect(
        shouldMigrateComplete({ completed: false, started: false, mediaGranted: false })
      ).toBe(false);
    });

    it('does not migrate when already completed', () => {
      expect(
        shouldMigrateComplete({ completed: true, started: false, mediaGranted: true })
      ).toBe(false);
    });
  });

  it('show and migrate are mutually exclusive across the state space', () => {
    for (const completed of [false, true]) {
      for (const started of [false, true]) {
        for (const mediaGranted of [false, true]) {
          const input = { completed, started, mediaGranted };
          expect(shouldShowOnboarding(input) && shouldMigrateComplete(input)).toBe(false);
        }
      }
    }
  });
});
