// Pure: a feed card's image load/decode priority, scored by how close it is to
// the card in view. The focused photo and its immediate neighbors (the ones you
// can swipe to next) outrank everything else so they win the iCloud download
// queue on an offloaded library; the hidden warm layer runs below 'normal'.
export type LoadPriority = 'low' | 'normal' | 'high';

// Cards within this many slots of the focused one count as immediate neighbors.
export const NEIGHBOR_RADIUS = 2;

export function cardLoadPriority(index: number, currentIndex: number): LoadPriority {
  // Focus unknown (nothing committed yet): don't elevate anything.
  if (currentIndex < 0) return 'low';
  if (index === currentIndex) return 'high';
  return Math.abs(index - currentIndex) <= NEIGHBOR_RADIUS ? 'normal' : 'low';
}
