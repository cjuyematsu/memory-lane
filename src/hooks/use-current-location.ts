import { useCallback, useEffect, useState } from 'react';
import * as Location from 'expo-location';

export type LocationState =
  | { status: 'idle' }
  | { status: 'requesting' }
  | { status: 'denied'; canAskAgain: boolean }
  | { status: 'error'; message: string }
  | { status: 'ready'; coords: { latitude: number; longitude: number } };

export function useCurrentLocation() {
  const [state, setState] = useState<LocationState>({ status: 'idle' });

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
    refresh();
  }, [refresh]);

  return { state, refresh };
}
