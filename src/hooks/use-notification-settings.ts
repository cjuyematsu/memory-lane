import { useEffect, useState } from 'react';

import { persistedFile, readPersisted } from '@/lib/persisted-file';

const FILE_NAME = 'notification-settings.json';

export type NotificationSettings = {
  enabled: boolean;
};

const DEFAULTS: NotificationSettings = {
  enabled: false,
};

let cached: NotificationSettings | null = null;
let inflight: Promise<NotificationSettings> | null = null;
const subscribers = new Set<(settings: NotificationSettings) => void>();

function notify() {
  if (!cached) return;
  for (const cb of subscribers) cb(cached);
}

function loadFromDisk(): Promise<NotificationSettings> {
  if (cached) return Promise.resolve(cached);
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const text = await readPersisted(FILE_NAME);
      if (text == null) {
        cached = { ...DEFAULTS };
        return cached;
      }
      const parsed = JSON.parse(text) as Partial<NotificationSettings>;
      cached = { ...DEFAULTS, ...parsed };
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
