import { withTimeoutDefault } from '@/lib/async-safety';
import { CONNECTIVITY_CHECK_MS } from '@/lib/loading-timeouts';

// Best-effort "is the device online right now?" — used to fail fast on a
// genuinely offline phone instead of waiting out an iCloud load deadline.
//
// expo-network is a NATIVE module. If it isn't in the running binary (a dev
// build made before it was added, or before the next native rebuild), even
// importing it throws "Cannot find native module 'ExpoNetwork'". Offline
// detection is only a refinement, so a missing module must NEVER crash the app:
// we load it through a guarded dynamic import and, if it's absent, fall back to
// "assume online" and let the bounded load deadline + retry/auto-skip cover the
// offline case. The whole check is also time-bounded so it can't hang either.
let networkUnavailable = false;

async function probeOnline(): Promise<boolean> {
  if (networkUnavailable) return true;
  try {
    const Network = await import('expo-network');
    const state = await Network.getNetworkStateAsync();
    // `isInternetReachable` can be undefined on iOS; only a hard `false` counts
    // as offline, so an unknown value reads as online — we still bound the
    // subsequent load with its own deadline.
    return (state.isConnected ?? true) && state.isInternetReachable !== false;
  } catch {
    // Native module absent (not yet rebuilt) or the read failed: stop probing
    // and assume online so we degrade to the deadline rather than crash.
    networkUnavailable = true;
    return true;
  }
}

export async function isOnline(): Promise<boolean> {
  return withTimeoutDefault(probeOnline(), CONNECTIVITY_CHECK_MS, true);
}
