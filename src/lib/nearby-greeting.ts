// Pure decision for the app-open "N memories near you" banner, extracted so it's
// unit-testable without pulling in React Native. Show the greeting only when:
// - there's at least one nearby memory to show,
// - this place isn't still in its 24h cooldown,
// - no banner is already on screen (don't clobber a geofence banner), and
// - the user didn't arrive via a notification tap (a cluster is already opening).
export function shouldGreet(p: {
  count: number;
  inCooldown: boolean;
  bannerActive: boolean;
  hasPendingCluster: boolean;
}): boolean {
  return p.count > 0 && !p.inCooldown && !p.bannerActive && !p.hasPendingCluster;
}
