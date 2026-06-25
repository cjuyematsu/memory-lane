// Pure gate logic for the first-run onboarding flow, kept separate from the
// React/native bits so it can be unit-tested.
//
// There's no first-run flag on installs that predate onboarding, so we can't
// just key off `completed`: an existing user who already granted photos under
// the old rapid-fire prompt must NOT be shown onboarding after updating. We
// treat "photos already granted, never started onboarding" as proof they've
// been through setup and migrate them to completed.
//
// The `started` flag is what keeps a *new* user who is mid-onboarding from
// being caught by that same heuristic: once they've seen the flow (and perhaps
// granted photos on an early step) they read as started, so a kill-and-relaunch
// keeps showing onboarding instead of skipping the rest.

export type OnboardingDecisionInput = {
  completed: boolean;
  // Whether the user has already begun the onboarding flow.
  started: boolean;
  // Whether photo-library access is currently granted.
  mediaGranted: boolean;
};

/** Show the flow unless it's done — and, for someone who hasn't started it,
 *  unless photos are already granted (an existing user we migrate instead). */
export function shouldShowOnboarding({
  completed,
  started,
  mediaGranted,
}: OnboardingDecisionInput): boolean {
  return !completed && (started || !mediaGranted);
}

/** Silently mark onboarding complete for an existing user: photos already
 *  granted, never started the flow, no completion flag yet. A new user who has
 *  started the flow is excluded, so granting photos then closing mid-onboarding
 *  doesn't skip the rest. */
export function shouldMigrateComplete({
  completed,
  started,
  mediaGranted,
}: OnboardingDecisionInput): boolean {
  return !completed && !started && mediaGranted;
}
