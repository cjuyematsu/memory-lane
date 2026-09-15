import { useEffect, useState } from 'react';

import * as Location from 'expo-location';

import { deletePersisted, persistedFile, readPersisted } from '@/lib/persisted-file';

// Demo mode exists for one reason: the app's hero feature is unfilmable by
// default. A memory notification only fires when you are physically standing at
// a place you photographed >90 days ago, that place isn't routine (home/work),
// and it isn't inside a cooldown window. You can't direct that, and you can't
// retake it.
//
// The key observation is that NOTHING about the notification has to be faked,
// only the coordinate: every gate in `handleClusterEnter`
// (lib/geofence-manager.ts) is evaluated against the CLUSTER's position, not
// against some notion of where you "really" are — isAreaNotifiable reads the
// cluster's own photo ages, isRoutineLocation/isInCooldown read the cluster
// center, isClusterInCooldown is keyed on the cluster id. So if the app
// genuinely believes it is standing at an old cluster, every production gate
// passes on its own merits and the notification body, the clusterId payload, the
// tap routing, and the cooldown writes are all real shipping code paths.
//
// This module is therefore just: one persisted lat/lng, and wrappers around the
// five position reads in the app that honor it.

const FILE_NAME = 'demo-mode.json';

// Build-time kill switch. A store build made WITHOUT this env var physically
// cannot carry demo mode: demoCoords() returns null unconditionally and the
// panel never renders. This is deliberately not a source constant you have to
// remember to flip back (the old settings-sheet DEMO_BUILD was one forgotten
// edit away from shipping) — EXPO_PUBLIC_* is inlined by Metro at build time, so
// the check is "was the var set when this binary was built", which is
// verifiable rather than reviewable.
export const DEMO_ENABLED = process.env.EXPO_PUBLIC_DEMO === '1';

export type DemoCoords = { latitude: number; longitude: number };

export type DemoModeState = {
  // Whether the override is currently rewriting position reads.
  enabled: boolean;
  // The coordinate every Location read is rewritten to while enabled.
  coords: DemoCoords | null;
  // Human label for the demo panel only, e.g. "4 photos · 6 years ago".
  label: string | null;
};

const DEFAULTS: DemoModeState = { enabled: false, coords: null, label: null };

let cached: DemoModeState | null = null;
let inflight: Promise<DemoModeState> | null = null;
const subscribers = new Set<(state: DemoModeState) => void>();

function notify() {
  if (!cached) return;
  for (const cb of subscribers) cb(cached);
}

// Pure: a coordinate is only usable if it is finite AND in range. A NaN or
// out-of-range lat/lng would flow straight into distanceMeters and poison every
// radius comparison in the app (NaN comparisons are always false, so nothing
// would ever be "nearby" and nothing would ever be "in cooldown"), so garbage
// degrades the whole state to off rather than to a bad coordinate.
export function isValidCoords(value: unknown): value is DemoCoords {
  if (!value || typeof value !== 'object') return false;
  const o = value as Record<string, unknown>;
  const { latitude, longitude } = o;
  return (
    typeof latitude === 'number' &&
    Number.isFinite(latitude) &&
    Math.abs(latitude) <= 90 &&
    typeof longitude === 'number' &&
    Number.isFinite(longitude) &&
    Math.abs(longitude) <= 180
  );
}

export function parseDemoMode(text: string | null): DemoModeState {
  if (text == null) return { ...DEFAULTS };
  try {
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ...DEFAULTS };
    }
    const o = parsed as Record<string, unknown>;
    const coords = isValidCoords(o.coords) ? { ...o.coords } : null;
    return {
      // Enabled without a usable coordinate is meaningless — and dangerous, since
      // callers would read `enabled` and expect coords — so it collapses to off.
      enabled: o.enabled === true && coords !== null,
      coords,
      label: typeof o.label === 'string' ? o.label : null,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

// Pure: the single place the build switch and the persisted state combine. Kept
// separate from demoCoords() so the kill switch is unit-testable without
// rebuilding with a different env.
export function demoCoordsFor(
  state: DemoModeState | null,
  buildEnabled: boolean
): DemoCoords | null {
  if (!buildEnabled) return null;
  if (!state || !state.enabled) return null;
  return isValidCoords(state.coords) ? state.coords : null;
}

function loadFromDisk(): Promise<DemoModeState> {
  if (cached) return Promise.resolve(cached);
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      cached = parseDemoMode(await readPersisted(FILE_NAME));
      return cached;
    } catch {
      cached = { ...DEFAULTS };
      return cached;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

function saveToDisk(state: DemoModeState): void {
  try {
    const file = persistedFile(FILE_NAME);
    if (!file.exists) file.create();
    file.write(JSON.stringify(state));
  } catch {
    // ignore write failure; in-memory state is still authoritative
  }
}

export function loadDemoModeFromDisk(): Promise<DemoModeState> {
  return loadFromDisk();
}

export function setDemoPlace(coords: DemoCoords, label: string): void {
  if (!DEMO_ENABLED || !isValidCoords(coords)) return;
  cached = { enabled: true, coords, label };
  notify();
  saveToDisk(cached);
}

export async function setDemoEnabled(enabled: boolean): Promise<void> {
  if (!DEMO_ENABLED) return;
  // Load first: toggling before the persisted state is in memory would spread
  // DEFAULTS and save coords:null over the place picked in an earlier session.
  const next = { ...(await loadFromDisk()), enabled };
  // Can't turn the override on without somewhere to teleport to.
  cached = next.coords == null ? { ...next, enabled: false } : next;
  notify();
  saveToDisk(cached);
}

export function useDemoMode(): DemoModeState {
  const [state, setState] = useState<DemoModeState>(() => cached ?? DEFAULTS);
  useEffect(() => {
    let cancelled = false;
    loadFromDisk().then((value) => {
      if (!cancelled) setState(value);
    });
    const subscriber = (value: DemoModeState) => setState(value);
    subscribers.add(subscriber);
    return () => {
      cancelled = true;
      subscribers.delete(subscriber);
    };
  }, []);
  return state;
}

// The override, resolved against whatever is already in memory. Synchronous on
// purpose: the position wrappers below are on hot paths (Near Me's location
// read, the geofence evaluation) and must not gain an await when demo mode is
// compiled out. `warmDemoMode()` primes `cached` at launch so the very first
// read after a cold start already sees the persisted override — which the hero
// shot needs, since tapping the notification cold-launches the app.
export function demoCoords(): DemoCoords | null {
  return demoCoordsFor(cached, DEMO_ENABLED);
}

export function warmDemoMode(): void {
  if (!DEMO_ENABLED) return;
  loadFromDisk().catch(() => {});
}

function syntheticPosition(coords: DemoCoords): Location.LocationObject {
  return {
    coords: {
      latitude: coords.latitude,
      longitude: coords.longitude,
      altitude: null,
      // A plausible good fix. Not null: some consumers treat a null accuracy as
      // an unusable reading.
      accuracy: 5,
      altitudeAccuracy: null,
      heading: null,
      speed: null,
    },
    timestamp: Date.now(),
  };
}

// The two seams. Every position read in the app goes through these; when demo
// mode is off (or compiled out) they are a direct pass-through to expo-location.
export async function getPosition(
  options?: Location.LocationOptions
): Promise<Location.LocationObject> {
  const demo = demoCoords();
  if (demo) return syntheticPosition(demo);
  return Location.getCurrentPositionAsync(options);
}

export async function getLastKnownPosition(): Promise<Location.LocationObject | null> {
  const demo = demoCoords();
  if (demo) return syntheticPosition(demo);
  return Location.getLastKnownPositionAsync();
}

// The persisted gates a real notification writes on its way out. Clearing them
// is what makes a take repeatable: the first real fire marks the cluster spent
// (cluster-cooldown) and drops a spatial quiet zone (notification-cooldown), so
// take two would be silently suppressed. place-presence matters more than it
// looks — the greeter logs a presence ping at your current coords on EVERY app
// open, so with the override on, shooting across three distinct days would make
// the demo place "routine" and silence it for good.
const GATE_FILES = [
  'cluster-cooldown.json',
  'notification-cooldown.json',
  'place-presence.json',
];

export async function resetDemoGates(): Promise<void> {
  if (!DEMO_ENABLED) return;
  for (const name of GATE_FILES) await deletePersisted(name);
}
