import { useEffect, useState } from 'react';

// "N memories near you". Driven by both the app-open greeter and a foreground
// geofence enter — both want the Near Me count and a tap that opens the Near Me
// grid (not a single place's cluster view). `count` is that nearby count.
export type BannerData = { kind: 'nearby'; count: number };

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
