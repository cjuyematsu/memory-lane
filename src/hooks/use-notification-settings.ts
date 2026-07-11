import { useEffect, useState } from 'react';

import { persistedFile, readPersisted } from '@/lib/persisted-file';
import { PLACE_COOLDOWN_DEFAULT_MS } from '@/lib/place-cooldown';

const FILE_NAME = 'notification-settings.json';

export type NotificationSettings = {
  enabled: boolean;
  // How long after a place reminds you before it may remind you there again.
  // null = "Only once" (that place is silenced indefinitely). See place-cooldown.ts.
  placeCooldownMs: number | null;
};

const DEFAULTS: NotificationSettings = {
  enabled: false,
  placeCooldownMs: PLACE_COOLDOWN_DEFAULT_MS,
};

let cached: NotificationSettings | null = null;
let inflight: Promise<NotificationSettings> | null = null;
const subscribers = new Set<(settings: NotificationSettings) => void>();

function notify() {
  if (!cached) return;
  for (const cb of subscribers) cb(cached);
}

// Pure: parse persisted settings without trusting field types. A wrong-typed
// placeCooldownMs (an older build, a tampered file) would flow into the
// cluster-cooldown's `now - at < windowMs` as NaN -> false -> that place
// re-notifies forever. Note `placeCooldownMs: null` is a LEGITIMATE persisted
// value ("Only once"), so present-null must survive while garbage falls back
// to the default.
export function parseNotificationSettings(text: string | null): NotificationSettings {
  const out = { ...DEFAULTS };
  if (text == null) return out;
  try {
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return out;
    const o = parsed as Record<string, unknown>;
    if (typeof o.enabled === 'boolean') out.enabled = o.enabled;
    if ('placeCooldownMs' in o) {
      const v = o.placeCooldownMs;
      if (v === null || (typeof v === 'number' && Number.isFinite(v) && v > 0)) {
        out.placeCooldownMs = v;
      }
    }
    return out;
  } catch {
    return out;
  }
}

function loadFromDisk(): Promise<NotificationSettings> {
  if (cached) return Promise.resolve(cached);
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      cached = parseNotificationSettings(await readPersisted(FILE_NAME));
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

function saveToDisk(settings: NotificationSettings): void {
  try {
    const file = persistedFile(FILE_NAME);
    if (!file.exists) file.create();
    file.write(JSON.stringify(settings));
  } catch {
    // ignore write failure; in-memory state is still authoritative
  }
}

export function setNotificationsEnabled(enabled: boolean): void {
  cached = { ...(cached ?? DEFAULTS), enabled };
  notify();
  saveToDisk(cached);
}

export function setPlaceCooldownMs(placeCooldownMs: number | null): void {
  cached = { ...(cached ?? DEFAULTS), placeCooldownMs };
  notify();
  saveToDisk(cached);
}

// Used by the background geofence task (possibly headless) to read the
// enabled flag without a React render.
export function loadSettingsFromDisk(): Promise<NotificationSettings> {
  return loadFromDisk();
}

export function useNotificationSettings(): NotificationSettings {
  const [settings, setSettings] = useState<NotificationSettings>(
    () => cached ?? DEFAULTS
  );
  useEffect(() => {
    let cancelled = false;
    loadFromDisk().then((value) => {
      if (!cancelled) setSettings(value);
    });
    const subscriber = (value: NotificationSettings) => setSettings(value);
    subscribers.add(subscriber);
    return () => {
      cancelled = true;
      subscribers.delete(subscriber);
    };
  }, []);
  return settings;
}
