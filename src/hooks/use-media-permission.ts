import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

import * as MediaLibrary from 'expo-media-library';
import type { GranularPermission } from 'expo-media-library';

// A single shared photo-permission state across the whole app. expo's
// `usePermissions` keeps per-hook state, so granting in Camera Roll wouldn't
// update Near Me (or vice versa). This module holds one cached response and
// notifies every consumer, so a grant in either tab immediately unlocks both.

// This app needs photos + videos, never audio. Scoping the granular set means
// `granted` reflects only those — otherwise on Android 13+ the *separate*
// "Music and audio" permission (READ_MEDIA_AUDIO) staying off keeps `granted`
// false even after the user allows "Photos and videos" in Settings, leaving
// the app stuck on the locked screen. (Ignored on iOS.)
const MEDIA_PERMISSIONS: GranularPermission[] = ['photo', 'video'];

let cached: MediaLibrary.PermissionResponse | null = null;
let inflight: Promise<MediaLibrary.PermissionResponse> | null = null;
let appStateSubscribed = false;
const subscribers = new Set<() => void>();

function notify() {
  for (const cb of subscribers) cb();
}

// Read-only: never prompts. The first-run OS prompt is owned by the onboarding
// flow (see `ensureMediaPermission`, called from the photos step of
// components/onboarding/onboarding-flow.tsx).
async function refresh(): Promise<MediaLibrary.PermissionResponse> {
  const res = await MediaLibrary.getPermissionsAsync(false, MEDIA_PERMISSIONS);
  cached = res;
  notify();
  return res;
}

async function request(): Promise<MediaLibrary.PermissionResponse> {
  const res = await MediaLibrary.requestPermissionsAsync(false, MEDIA_PERMISSIONS);
  cached = res;
  notify();
  return res;
}

// Drives the photos step of onboarding: surface the OS prompt only while we can
// still ask (undetermined), then push the result to every consumer so the app
// unlocks the instant access is granted. Awaited by the onboarding flow so the
// step's spinner stays up until the user has answered.
export async function ensureMediaPermission(): Promise<MediaLibrary.PermissionResponse> {
  let res = await MediaLibrary.getPermissionsAsync(false, MEDIA_PERMISSIONS);
  if (!res.granted && res.canAskAgain) {
    res = await MediaLibrary.requestPermissionsAsync(false, MEDIA_PERMISSIONS);
  }
  cached = res;
  notify();
  return res;
}

// Re-read the permission without prompting. This is what lets the app unlock
// after the user grants access in system Settings (via the "Open Settings"
// fallback, when canAskAgain is false) and returns — otherwise the cached
// "denied" response would persist and keep showing the locked screen. Only
// notifies when the meaningful state actually changed, to avoid re-rendering
// consumers on every foreground.
async function recheck(): Promise<void> {
  const res = await MediaLibrary.getPermissionsAsync(false, MEDIA_PERMISSIONS);
  if (
    cached &&
    cached.granted === res.granted &&
    cached.canAskAgain === res.canAskAgain
  ) {
    return;
  }
  cached = res;
  notify();
}

function ensureAppStateListener() {
  if (appStateSubscribed) return;
  appStateSubscribed = true;
  AppState.addEventListener('change', (state) => {
    if (state === 'active') recheck();
  });
}

export function useMediaPermission(): [
  MediaLibrary.PermissionResponse | null,
  () => Promise<MediaLibrary.PermissionResponse>,
] {
  const [permission, setPermission] = useState(cached);
  useEffect(() => {
    const cb = () => setPermission(cached);
    subscribers.add(cb);
    ensureAppStateListener();
    if (cached == null && !inflight) {
      inflight = refresh().finally(() => {
        inflight = null;
      });
    }
    return () => {
      subscribers.delete(cb);
    };
  }, []);
  return [permission, request];
}
