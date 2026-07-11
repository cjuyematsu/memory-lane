import { useEffect, useState } from 'react';

import { persistedFile, readPersisted } from '@/lib/persisted-file';

// First-run flag for the onboarding flow. Same module-cache + subscriber-set +
// loadFromDisk/save pattern as use-notification-settings.ts, so flipping it
// (e.g. the Settings "Replay intro" row) immediately re-renders the gate.

const FILE_NAME = 'onboarding.json';

export type OnboardingState = {
  completed: boolean;
  // True once the user has actually seen the flow. Distinguishes a new user who
  // is mid-onboarding (must keep seeing it) from an existing upgrader who
  // already had photos granted under the old flow (migrate straight to done).
  started: boolean;
  // The step the user last reached, so a kill mid-flow resumes where it left off.
  step: number;
};

const DEFAULTS: OnboardingState = {
  completed: false,
  started: false,
  step: 0,
};

let cached: OnboardingState | null = null;
let inflight: Promise<OnboardingState> | null = null;
const subscribers = new Set<(state: OnboardingState) => void>();

function notify() {
  if (!cached) return;
  for (const cb of subscribers) cb(cached);
}

// Pure: parse persisted state without trusting field types — a garbage `step`
// must not strand the resume seed on a nonexistent page, and a non-boolean
// `completed` must not skip (or trap) the whole flow.
export function parseOnboardingState(text: string | null): OnboardingState {
  const out = { ...DEFAULTS };
  if (text == null) return out;
  try {
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return out;
    const o = parsed as Record<string, unknown>;
    if (typeof o.completed === 'boolean') out.completed = o.completed;
    if (typeof o.started === 'boolean') out.started = o.started;
    if (typeof o.step === 'number' && Number.isInteger(o.step) && o.step >= 0) {
      out.step = o.step;
    }
    return out;
  } catch {
    return out;
  }
}

function loadFromDisk(): Promise<OnboardingState> {
  if (cached) return Promise.resolve(cached);
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      cached = parseOnboardingState(await readPersisted(FILE_NAME));
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

function saveToDisk(state: OnboardingState): void {
  try {
    const file = persistedFile(FILE_NAME);
    if (!file.exists) file.create();
    file.write(JSON.stringify(state));
  } catch {
    // ignore write failure; in-memory state is still authoritative
  }
}

export function setOnboardingCompleted(completed: boolean): void {
  cached = { ...(cached ?? DEFAULTS), completed };
  notify();
  saveToDisk(cached);
}

// Persist forward progress so a kill mid-onboarding resumes where it left off,
// and so the user reads as mid-flow (not an upgrader to silently migrate). No
// notify(): only `completed` drives the gate, so step churn shouldn't re-render
// the tree on every tap.
export function saveOnboardingProgress(step: number): void {
  cached = { ...(cached ?? DEFAULTS), started: true, step };
  saveToDisk(cached);
}

// Replay the intro from the top (the Settings row): show it again regardless of
// already-granted permissions, restarting at step 0.
export function restartOnboarding(): void {
  cached = { ...(cached ?? DEFAULTS), completed: false, started: true, step: 0 };
  notify();
  saveToDisk(cached);
}

// Synchronous read of the current state. The cache is warm by the time the flow
// mounts (the gate loaded it first), so the flow uses this to seed its step.
export function getOnboardingState(): OnboardingState {
  return cached ?? DEFAULTS;
}

// Read the flag without a React render (used by the gate's first-run decision).
export function loadOnboardingFromDisk(): Promise<OnboardingState> {
  return loadFromDisk();
}

export function useOnboarding(): OnboardingState {
  const [state, setState] = useState<OnboardingState>(() => cached ?? DEFAULTS);
  useEffect(() => {
    let cancelled = false;
    loadFromDisk().then((value) => {
      if (!cancelled) setState(value);
    });
    const subscriber = (value: OnboardingState) => setState(value);
    subscribers.add(subscriber);
    return () => {
      cancelled = true;
      subscribers.delete(subscriber);
    };
  }, []);
  return state;
}
