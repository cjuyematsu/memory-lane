// Pure layout math for the viewer's filmstrip (components/near-me/viewer.tsx),
// a horizontal windowed FlatList of fixed-stride thumbs. Extracted so the
// centering/windowing math is unit-testable.
//
// The strip must OPEN already positioned on the tapped photo, which needs BOTH
// props on the FlatList:
//  - `contentOffset` puts the scroll position at the exact centered offset
//    (no scroll sweep on open);
//  - `initialScrollIndex` seeds VirtualizedList's initial render region.
//    Without it the region is cells [0, initialNumToRender) regardless of
//    contentOffset, so opening deep in a dense area lands the viewport on
//    UNRENDERED cells — a blank strip until scroll events arrive.
// They compose cleanly: when `contentOffset` is set, VirtualizedList skips its
// own initialScrollIndex scroll (_maybeScrollToInitialScrollIndex) and uses the
// index only for the render window.

export const THUMB_SIZE = 56;
export const THUMB_GAP = 6;
export const THUMB_STRIDE = THUMB_SIZE + THUMB_GAP;
// Leading/trailing padding of the filmstrip content (styles.filmstrip).
export const FILMSTRIP_PAD_H = 12;

/** Filmstrip offset that puts thumb i's center under the screen midline
 *  (clamped at the strip's start; the list clamps the far end itself). */
export function filmCenterOffset(i: number, screenW: number): number {
  return Math.max(0, FILMSTRIP_PAD_H + i * THUMB_STRIDE - screenW / 2 + THUMB_SIZE / 2);
}

/** Index of the first thumb visible at the centered offset — the
 *  `initialScrollIndex` that makes the initial render region cover the opened
 *  viewport. Clamped to [0, count-1]: VirtualizedList warns on out-of-range. */
export function filmInitialScrollIndex(
  startIndex: number,
  screenW: number,
  count: number
): number {
  const offset = filmCenterOffset(startIndex, screenW);
  const first = Math.floor((offset - FILMSTRIP_PAD_H) / THUMB_STRIDE);
  return Math.max(0, Math.min(count - 1, first));
}
