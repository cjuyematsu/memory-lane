import { useEffect, useState } from 'react';

// Holds the cluster id the user tapped a notification for, so the UI can
// switch to Near Me and show that location's photos. Module-level so the
// notification-response listener (outside React) and components can share it.
let pendingClusterId: string | null = null;
const subscribers = new Set<() => void>();

function notify() {
  for (const fn of subscribers) fn();
}

export function setPendingCluster(id: string | null): void {
  if (pendingClusterId === id) return;
  pendingClusterId = id;
  notify();
}

export function getPendingCluster(): string | null {
  return pendingClusterId;
}

export function usePendingCluster(): string | null {
  const [id, setId] = useState<string | null>(pendingClusterId);
  useEffect(() => {
    const fn = () => setId(pendingClusterId);
    subscribers.add(fn);
    return () => {
      subscribers.delete(fn);
    };
  }, []);
  return id;
}
