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
