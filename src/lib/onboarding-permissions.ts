import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';

import { notifyLocationChanged } from '@/hooks/use-current-location';
import { ensureMediaPermission } from '@/hooks/use-media-permission';

let started = false;

/**
 * First-run permission onboarding.
 *
 * Surfaces the OS prompts in a deliberate, non-overlapping order — photos, then
 * location, then notifications — each awaited before the next so the dialogs
 * never stack on top of one another (which is what made the location prompt
 * appear under the photos prompt before).
 *
 * "Standard" scope:
 *  - Location asks for When-In-Use only. The "Always" upgrade that background
 *    geofencing needs is requested later, when the user turns on Memory
 *    notifications (see `requestAllPermissions`).
 *  - Notification permission is requested here, but the feature itself stays
 *    off until the user enables it from Settings (we never auto-enable).
 *
 * Idempotent: guarded once per JS session, and each OS prompt only ever appears
 * while that permission is still undetermined — so a permission granted in a
 * previous launch makes the corresponding step a silent no-op.
 */
export async function runOnboardingPermissions(): Promise<void> {
  if (started) return;
  started = true;

  // 1. Photos — the whole app is gated on photo-library access.
  await ensureMediaPermission();

  // 2. Location (When-In-Use). Only prompt while still undetermined; once the
  //    user has answered, never re-ask here.
  const fg = await Location.getForegroundPermissionsAsync();
  if (fg.status === 'undetermined' && fg.canAskAgain) {
    await Location.requestForegroundPermissionsAsync();
  }
  // Let a visible Near Me re-read the result and fetch a fix (no second prompt).
  notifyLocationChanged();

  // 3. Notifications. Asked now so enabling memories later is a single tap, but
  //    the feature stays off until the user flips the Settings toggle.
  const notif = await Notifications.getPermissionsAsync();
  if (notif.status === 'undetermined' && notif.canAskAgain) {
    await Notifications.requestPermissionsAsync();
  }
}
