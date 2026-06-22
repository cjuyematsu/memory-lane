import { useEffect, useState } from 'react';

export type BannerData =
  // A single place the user just entered (geofence). Tapping opens that cluster.
  | { kind: 'cluster'; clusterId: string; count: number }
  // The app-open "N memories near you" greeting. Tapping opens the Near Me grid.
  | { kind: 'nearby'; count: number };

// Module-level so the geofence task handler (non-React) can trigger the banner
// that the MemoryBanner component renders.
let current: BannerData | null = null;
const subscribers = new Set<() => void>();

function notify() {
  for (const fn of subscribers) fn();
}

export function showBanner(data: BannerData): void {
  current = data;
  notify();
}

// True while a banner is on screen, so the app-open greeter can yield to an
// already-showing geofence banner rather than clobbering it.
export function isBannerActive(): boolean {
  return current != null;
}

export function clearBanner(): void {
  if (!current) return;
  current = null;
  notify();
}

export function useBanner(): BannerData | null {
  const [data, setData] = useState<BannerData | null>(current);
  useEffect(() => {
    const fn = () => setData(current);
    subscribers.add(fn);
    return () => {
      subscribers.delete(fn);
    };
  }, []);
  return data;
}
