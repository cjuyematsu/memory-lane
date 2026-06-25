import { useEffect, useState } from 'react';

import * as MediaLibrary from 'expo-media-library';
import type { GranularPermission } from 'expo-media-library';

import {
  loadOnboardingFromDisk,
  setOnboardingCompleted,
  useOnboarding,
} from '@/hooks/use-onboarding';
import { shouldMigrateComplete } from '@/lib/onboarding-decision';

// Same granular scope as use-media-permission.ts: photos + videos, never audio.
const MEDIA_PERMISSIONS: GranularPermission[] = ['photo', 'video'];

export type OnboardingStatus = 'deciding' | 'active' | 'done';

/**
 * The first-run gate, lifted to a hook so `_layout` can withhold the whole app
 * (`<Slot />` + the location-using greeter) until onboarding is finished.
 * Otherwise the live Near Me, mounted under the overlay, prompts for location
 * on the AppState 'active' that fires when an OS permission dialog dismisses.
 *
 * - 'deciding': resolving the persisted flag + the existing-user migration. The
 *   boot Polaroid covers this; render neither the app nor the flow yet.
 * - 'active':   show the onboarding flow, withhold the app.
 * - 'done':     onboarding complete (or migrated), show the app.
 */
export function useOnboardingStatus(): OnboardingStatus {
  const { completed } = useOnboarding();
  const [decided, setDecided] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      const state = await loadOnboardingFromDisk();
      // Migration: installs predating onboarding have no flag. If photos are
      // already granted, they've been through the old setup, so mark complete so
      // the update doesn't re-onboard them.
      if (!state.completed) {
        try {
          const perm = await MediaLibrary.getPermissionsAsync(false, MEDIA_PERMISSIONS);
          if (
            shouldMigrateComplete({
              completed: state.completed,
              started: state.started,
              mediaGranted: perm.granted,
            })
          ) {
            setOnboardingCompleted(true);
          }
        } catch {
          // If we can't read the permission, fall through and show onboarding.
        }
      }
      if (active) setDecided(true);
    })();
    return () => {
      active = false;
    };
  }, []);

  if (!decided) return 'deciding';
  return completed ? 'done' : 'active';
}
