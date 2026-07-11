// Order in which to probe assets for an on-device one to open the Camera Roll
// on, so a cold launch paints a real photo instead of an iCloud spinner.
//
// Random first, to preserve the "random memory" feel when plenty of photos are
// local; then the newest photos (the most likely to be kept on-device under
// "Optimize iPhone Storage") as a fast-paint fallback for a heavily-offloaded
// library. Pure + injectable RNG so it's deterministically testable.
export function entryCandidateOrder(
  total: number,
  rand: () => number = Math.random,
  randomN = 30,
  recentN = 20
): number[] {
  const order: number[] = [];
  const seen = new Set<number>();
  const push = (i: number) => {
    if (i >= 0 && i < total && !seen.has(i)) {
      seen.add(i);
      order.push(i);
    }
  };
  for (let i = 0; i < randomN; i += 1) push(Math.floor(rand() * total));
  for (let i = 0; i < recentN && i < total; i += 1) push(i);
  return order;
}

// Which index the shuffle-queue refill should sample next. `wantOld` biases
// into the older two-thirds of the (newest-first) library: one queue slot per
// refill is reserved for an old sample, so older photos enter the rotation
// from the very first shuffles instead of arriving only via the slow
// old-memory download trickle (the early-session feed skewed hard to recent
// photos, since only those were instantly renderable). Pure + injectable RNG.
export function refillCandidateIndex(
  total: number,
  wantOld: boolean,
  rand: () => number = Math.random
): number {
  if (wantOld) {
    const start = Math.floor(total / 3);
    if (start < total) return start + Math.floor(rand() * (total - start));
  }
  return Math.floor(rand() * total);
}
