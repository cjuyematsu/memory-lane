// Pure helper for the feed's "Find one on device" action. When a photo can't
// load (offline / stalled iCloud), the user can jump to the nearest memory that
// is already on the device (so it shows instantly instead of another spinner).
// Kept out of the component so the search is unit-tested.

// Index of the nearest on-device photo searching FORWARD from `currentIndex`
// (older = the swipe-forward direction), wrapping around to cover earlier ones.
// `inCloud === undefined` means "never probed" and does NOT count — we only jump
// toward a photo we KNOW is local. Returns null when none is known on-device.
export function nextOnDeviceIndex(
  candidates: { inCloud: boolean | undefined }[],
  currentIndex: number
): number | null {
  const n = candidates.length;
  // step < n (not <= n): the n-th step would wrap back to currentIndex itself,
  // which we must never return as the "next" photo.
  for (let step = 1; step < n; step += 1) {
    const i = (currentIndex + step) % n;
    if (candidates[i].inCloud === false) return i;
  }
  return null;
}
