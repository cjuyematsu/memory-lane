import { useEffect, useState } from 'react';

import * as MediaLibrary from 'expo-media-library';
import type { GranularPermission } from 'expo-media-library';

import {
  loadOnboardingFromDisk,
  setOnboardingCompleted,
  useOnboarding,
} from '@/hooks/use-onboarding';
import { withTimeoutDefault } from '@/lib/async-safety';
import { ONBOARDING_PROBE_MS } from '@/lib/loading-timeouts';
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
      // Every await here is bounded: this gate withholds the WHOLE app, so a
      // single hung native read (disk or the Photos permission, neither of which
      // has a built-in timeout) would strand the user on the boot Polaroid
      // forever. On a stall we fall back to safe defaults and still decide.
      const state = await withTimeoutDefault(loadOnboardingFromDisk(), ONBOARDING_PROBE_MS, {
        completed: false,
        started: false,
        step: 0,
      });
      // Migration: installs predating onboarding have no flag. If photos are
      // already granted, they've been through the old setup, so mark complete so
      // the update doesn't re-onboard them. A stalled/failed permission read
      // resolves to `false` → don't migrate → show onboarding (the safe default).
      if (!state.completed) {
        const mediaGranted = await withTimeoutDefault(
          MediaLibrary.getPermissionsAsync(false, MEDIA_PERMISSIONS)
            .then((p) => p.granted)
            .catch(() => false),
          ONBOARDING_PROBE_MS,
          false
        );
        if (
          shouldMigrateComplete({
            completed: state.completed,
            started: state.started,
            mediaGranted,
          })
        ) {
          setOnboardingCompleted(true);
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
