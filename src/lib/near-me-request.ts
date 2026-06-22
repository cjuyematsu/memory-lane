// A fire-and-forget request to switch to the Near Me tab — used by the app-open
// "N memories near you" banner, which wants the tab but NOT a cluster overlay
// (setPendingCluster would also open ClusterView). Module-level pub/sub, same
// shape as pending-cluster.ts, so the banner (outside TopTabs) can drive it.
const subscribers = new Set<() => void>();

export function requestNearMe(): void {
  for (const fn of subscribers) fn();
}

export function subscribeNearMeRequest(cb: () => void): () => void {
  subscribers.add(cb);
  return () => {
    subscribers.delete(cb);
  };
}
