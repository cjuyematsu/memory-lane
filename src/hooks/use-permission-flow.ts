import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';

export type PermissionStatus = 'granted' | 'denied' | 'undetermined';

export type PermissionState = {
  foregroundLocation: PermissionStatus;
  backgroundLocation: PermissionStatus;
  notifications: PermissionStatus;
};

export type PermissionResult = {
  state: PermissionState;
  ok: boolean;
};

function toStatus(status: string): PermissionStatus {
  if (status === 'granted') return 'granted';
  if (status === 'undetermined') return 'undetermined';
  return 'denied';
}

export async function getPermissionState(): Promise<PermissionState> {
  const [fg, bg, notif] = await Promise.all([
    Location.getForegroundPermissionsAsync(),
    Location.getBackgroundPermissionsAsync(),
    Notifications.getPermissionsAsync(),
  ]);
  return {
    foregroundLocation: toStatus(fg.status),
    backgroundLocation: toStatus(bg.status),
    notifications: toStatus(notif.status),
  };
}

export async function requestAllPermissions(): Promise<PermissionResult> {
  // Step 1: foreground location. iOS gates the always prompt behind a
  // when-in-use grant, and there's no point continuing if the user blocks
  // foreground — nothing about the feature can run.
  let fg = await Location.getForegroundPermissionsAsync();
  if (fg.status !== 'granted') {
    fg = await Location.requestForegroundPermissionsAsync();
  }
  if (fg.status !== 'granted') {
    return {
      state: {
        foregroundLocation: toStatus(fg.status),
        backgroundLocation: 'undetermined',
        notifications: 'undetermined',
      },
      ok: false,
    };
  }

  // Step 2: background location. On iOS this is the "Always" prompt; on
  // Android 11+ this may bounce the user to system Settings rather than a
  // dialog. Either way, we keep going to ask for notifications even if
  // this is denied — the result reports it as denied so the caller can
  // decide whether to allow degraded mode.
  let bg = await Location.getBackgroundPermissionsAsync();
  if (bg.status !== 'granted') {
    bg = await Location.requestBackgroundPermissionsAsync();
  }

  // Step 3: notifications. On Android 13+ this is a real runtime prompt;
  // on iOS it's the usual notification authorization dialog.
  let notif = await Notifications.getPermissionsAsync();
  if (notif.status !== 'granted') {
    notif = await Notifications.requestPermissionsAsync();
  }

  const state: PermissionState = {
    foregroundLocation: toStatus(fg.status),
    backgroundLocation: toStatus(bg.status),
    notifications: toStatus(notif.status),
  };
  return {
    state,
    ok:
      state.foregroundLocation === 'granted' &&
      state.backgroundLocation === 'granted' &&
      state.notifications === 'granted',
  };
}
