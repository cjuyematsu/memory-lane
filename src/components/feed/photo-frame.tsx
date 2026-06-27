import { type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { FrameMargin, HeaderHeight, Letterbox, PhotoRatio } from '@/constants/theme';

const HEADER_GAP = 16;

/** Y offset of the frame: clears the safe area + nav bar. Shared so the live
 *  card and its splash/crossfade overlays line up exactly. */
export function frameTop(insetTop: number): number {
  return insetTop + HeaderHeight + HEADER_GAP;
}

// The single-photo frame: a 768×1024 (3:4) box, thin ink border, letterbox-black
// behind it (shows as bars for contained landscape photos). Absolutely
// positioned at a fixed `top` so the live card and its splash/crossfade overlays
// line up exactly. Callers set the image's contentFit (cover for portrait,
// contain for landscape).

export function frameWidth(screenW: number): number {
  return screenW - 2 * FrameMargin;
}

export function frameHeight(screenW: number): number {
  return frameWidth(screenW) / PhotoRatio;
}

export type FrameLayout = { top: number; left: number; width: number; height: number };

// Vertical space below the frame for the caption + shuffle button (+ safe-area
// inset, added separately). The frame is sized to leave this much room, so on
// phones it stays the full-width box and on iPad it shrinks to keep the caption
// and shuffle on screen. Lives here (next to frameLayout) as the single source of
// truth: the feed AND the off-screen entry-warm host (feed-entry-warm-host.tsx)
// both size their frame from it, and a mismatch would silently miss the warmed
// photo's size-keyed cache entry.
export const FEED_BOTTOM_RESERVE = 130;

// The framed-photo geometry: the largest 3:4 box that fits the screen width and
// the vertical space left below the header after reserving `bottomReserve` for
// the caption and any controls, centered horizontally. On phones this resolves
// to the full-width frame (sized by width); on tall/large screens like iPad it
// shrinks to fit so the caption and controls stay on screen instead of being
// pushed off the bottom.
export function frameLayout(
  screenW: number,
  screenH: number,
  insetTop: number,
  insetBottom: number,
  bottomReserve: number
): FrameLayout {
  const top = frameTop(insetTop);
  const maxWidth = frameWidth(screenW);
  const available = Math.max(0, screenH - top - insetBottom - bottomReserve);
  const height = Math.min(maxWidth / PhotoRatio, available);
  const width = height * PhotoRatio;
  const left = (screenW - width) / 2;
  return { top, left, width, height };
}

export function PhotoFrame({
  screenW,
  top,
  width,
  height,
  left,
  children,
}: {
  screenW?: number;
  top: number;
  // Overrides for callers that size the frame explicitly (e.g. the adaptive
  // feed/viewer layouts via frameLayout). Fall back to the full-width
  // screenW-derived box when omitted.
  width?: number;
  height?: number;
  left?: number;
  children?: ReactNode;
}) {
  return (
    <View
      style={[
        styles.frame,
        {
          top,
          left: left ?? FrameMargin,
          width: width ?? frameWidth(screenW ?? 0),
          height: height ?? frameHeight(screenW ?? 0),
        },
      ]}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    position: 'absolute',
    // Wider black border; uses the same true-black as the letterbox so a
    // landscape photo's bars and the border read as one continuous frame.
    borderWidth: 10,
    borderColor: Letterbox,
    backgroundColor: Letterbox,
    overflow: 'hidden',
  },
});
