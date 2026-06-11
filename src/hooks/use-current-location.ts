import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import * as Location from 'expo-location';

export type LocationState =
  | { status: 'idle' }
  | { status: 'requesting' }
  | { status: 'denied'; canAskAgain: boolean }
  | { status: 'error'; message: string }
  | { status: 'ready'; coords: { latitude: number; longitude: number } };

// Mounted consumers register here so the onboarding sequencer and the app
// foreground re-check can tell them to re-read the location permission and
// fetch a fix (without prompting).
const subscribers = new Set<() => void>();
let appStateSubscribed = false;

// Called by `src/lib/onboarding-permissions.ts` after the location step, and on
// every app foreground (below), so a grant made in system Settings populates
// Near Me on its own — no manual tap.
export function notifyLocationChanged() {
  for (const cb of subscribers) cb();
}

function ensureAppStateListener() {
  if (appStateSubscribed) return;
  appStateSubscribed = true;
  // Returning from system Settings (where the user may have just granted
  // location) fires 'active'; re-check so Near Me recovers automatically —
  // mirrors the media-permission hook's foreground re-check.
  AppState.addEventListener('change', (s) => {
    if (s === 'active') notifyLocationChanged();
  });
}

export function useCurrentLocation() {
  const [state, setState] = useState<LocationState>({ status: 'idle' });
  // Latest state, readable inside the stable `load` callback without recreating
  // it — lets a foreground re-check skip refetching GPS when we already have a
  // fix (which would otherwise flash a spinner over the grid on every resume).
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // Read-only: fetch a fix only if foreground location is already granted, and
  // never prompt. The first-run prompt is owned by the onboarding sequencer.
  // While the answer is still undetermined we hold a neutral loading state; a
  // real denial drops to the 'denied' screen so the user can retry / open
  // Settings.
  const load = useCallback(async () => {
    try {
      const perm = await Location.getForegroundPermissionsAsync();
      if (perm.status === 'granted') {
        if (stateRef.current.status === 'ready') return; // already have a fix
        setState({ status: 'requesting' });
        const pos = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        setState({
          status: 'ready',
          coords: {
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
          },
        });
        return;
      }
      if (perm.canAskAgain) {
        if (stateRef.current.status !== 'ready') setState({ status: 'requesting' });
        return;
      }
      setState({ status: 'denied', canAskAgain: perm.canAskAgain });
    } catch (e) {
      setState({
        status: 'error',
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }, []);

  // User-initiated retry (the "Try again" button). Allowed to prompt; runs only
  // on tap, never on mount.
  const refresh = useCallback(async () => {
    setState({ status: 'requesting' });
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== 'granted') {
        setState({ status: 'denied', canAskAgain: perm.canAskAgain });
        return;
      }
      const pos = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      setState({
        status: 'ready',
        coords: { latitude: pos.coords.latitude, longitude: pos.coords.longitude },
      });
    } catch (e) {
      setState({
        status: 'error',
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }, []);

  useEffect(() => {
    const cb = () => load();
    subscribers.add(cb);
    ensureAppStateListener();
    load();
    return () => {
      subscribers.delete(cb);
    };
  }, [load]);

  return { state, refresh };
}
