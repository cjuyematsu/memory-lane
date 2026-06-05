import { useCallback, useEffect, useState } from 'react';
import * as Location from 'expo-location';

export type LocationState =
  | { status: 'idle' }
  | { status: 'requesting' }
  | { status: 'denied'; canAskAgain: boolean }
  | { status: 'error'; message: string }
  | { status: 'ready'; coords: { latitude: number; longitude: number } };

// Mounted consumers register here so the onboarding sequencer can tell them to
// re-read the result of the location prompt it owns (without prompting again).
const subscribers = new Set<() => void>();

// Called by `src/lib/onboarding-permissions.ts` once the location step has run,
// so any visible Near Me picks up the grant and fetches a fix immediately.
export function notifyLocationChanged() {
  for (const cb of subscribers) cb();
}

export function useCurrentLocation() {
  const [state, setState] = useState<LocationState>({ status: 'idle' });

  // Read-only: fetch a fix only if foreground location is already granted, and
  // never prompt. The first-run prompt is owned by the onboarding sequencer so
  // the location dialog can't race the photos one. While the answer is still
  // undetermined we hold a neutral loading state (the sequencer is about to
  // ask); a real denial drops to the 'denied' screen so the user can retry or
  // open Settings.
  const load = useCallback(async () => {
    try {
      const perm = await Location.getForegroundPermissionsAsync();
      if (perm.status === 'granted') {
        setState((prev) =>
          prev.status === 'ready' ? prev : { status: 'requesting' }
        );
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
        // Undetermined — the sequencer will surface the prompt; show a spinner
        // rather than the "needs location" screen until it resolves.
        setState((prev) =>
          prev.status === 'ready' ? prev : { status: 'requesting' }
        );
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

  // User-initiated retry (the "Try again" / "Refresh" buttons). This one is
  // allowed to prompt — it runs only when the user taps, never on mount.
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
    load();
    return () => {
      subscribers.delete(cb);
    };
  }, [load]);

  return { state, refresh };
}
