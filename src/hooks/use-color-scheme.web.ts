import { useSyncExternalStore } from 'react';
import { useColorScheme as useRNColorScheme } from 'react-native';

// Hydration detector without an effect/setState pair: the server snapshot is
// false, the client snapshot is true, and nothing ever changes after mount.
const emptySubscribe = () => () => {};
function useHasHydrated(): boolean {
  return useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false
  );
}

/**
 * To support static rendering, this value needs to be re-calculated on the client side for web
 */
export function useColorScheme() {
  const hasHydrated = useHasHydrated();
  const colorScheme = useRNColorScheme();
  return hasHydrated ? colorScheme : 'light';
}
