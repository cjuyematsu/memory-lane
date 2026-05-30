import { useEffect, useState } from 'react';

export type BannerData = {
  clusterId: string;
  count: number;
};

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
