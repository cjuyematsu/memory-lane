// Pure gate for degrading a notification "enabled" flag the OS can no longer
// honor, kept React/native-free so it can be unit-tested (same style as
// onboarding-decision.ts).
//
// The state it targets: settings say notifications are on, but the runtime
// permissions behind the feature are all missing. That happens when Android
// Auto Backup restores the settings file (and the registered geofence task)
// onto a reinstall whose permissions were reset, or when the user revokes the
// permissions in system Settings. Left alone, the restored geofence task
// auto-starts at boot and fires a no-gesture permission request that Android
// filters and never answers — which wedged the whole permission pipeline on
// Android 16. Degrading to "off" routes the user through the Settings toggle,
// which re-asks properly on an explicit tap.

export type NotificationDegradeInput = {
  enabled: boolean;
  // `null` = the permission read failed or timed out (cold Photos/OS framework
  // at launch) — unknown, NOT a denial.
  notifGranted: boolean | null;
  backgroundLocationGranted: boolean | null;
};

/** True only when the flag is on and BOTH permissions are confirmed missing.
 *  - Notifications granted → the feature works (bg location missing just means
 *    the designed foreground-fallback mode), never degrade.
 *  - An unknown (`null`) read must never silently switch the user's setting
 *    off; only a successful read that says "not granted" counts. */
export function shouldDegradeNotifications({
  enabled,
  notifGranted,
  backgroundLocationGranted,
}: NotificationDegradeInput): boolean {
  return enabled && notifGranted === false && backgroundLocationGranted === false;
}
