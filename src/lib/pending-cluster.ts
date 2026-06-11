import { useEffect, useState } from 'react';

// Holds the cluster id the user tapped a notification/banner for, so the UI can
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

// Direct store subscription for callers that react to changes with their own
// state (e.g. TopTabs switching tabs) — setState belongs in the callback, not
// in an effect watching the hook value. Returns the unsubscribe function.
export function subscribePendingCluster(
  cb: (id: string | null) => void
): () => void {
  const fn = () => cb(pendingClusterId);
  subscribers.add(fn);
  return () => {
    subscribers.delete(fn);
  };
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
