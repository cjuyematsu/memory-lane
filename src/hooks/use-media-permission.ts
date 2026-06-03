import { useEffect, useState } from 'react';

import * as MediaLibrary from 'expo-media-library';

// A single shared photo-permission state across the whole app. expo's
// `usePermissions` keeps per-hook state, so granting in Camera Roll wouldn't
// update Near Me (or vice versa). This module holds one cached response and
// notifies every consumer, so a grant in either tab immediately unlocks both.

let cached: MediaLibrary.PermissionResponse | null = null;
let inflight: Promise<MediaLibrary.PermissionResponse> | null = null;
let autoPrompted = false;
const subscribers = new Set<() => void>();

function notify() {
  for (const cb of subscribers) cb();
}

async function refresh(): Promise<MediaLibrary.PermissionResponse> {
  let res = await MediaLibrary.getPermissionsAsync();
  cached = res;
  notify();
  // First launch: surface the OS prompt automatically so the user never has to
  // tap "Grant access". Only when we can still ask (undetermined) — once they
  // hard-deny, `canAskAgain` is false and we fall back to the manual screen.
  if (!autoPrompted && !res.granted && res.canAskAgain) {
    autoPrompted = true;
    res = await MediaLibrary.requestPermissionsAsync();
    cached = res;
    notify();
  }
  return res;
}

async function request(): Promise<MediaLibrary.PermissionResponse> {
  const res = await MediaLibrary.requestPermissionsAsync();
  cached = res;
  notify();
  return res;
}

export function useMediaPermission(): [
  MediaLibrary.PermissionResponse | null,
  () => Promise<MediaLibrary.PermissionResponse>,
] {
  const [permission, setPermission] = useState(cached);
  useEffect(() => {
    const cb = () => setPermission(cached);
    subscribers.add(cb);
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
