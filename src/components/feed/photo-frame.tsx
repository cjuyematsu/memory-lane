import { type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { FrameMargin, HeaderHeight, Letterbox, PhotoRatio } from '@/constants/theme';

const HEADER_GAP = 6; // breathing room between the nav and the framed photo

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

export function PhotoFrame({
  screenW,
  top,
  children,
}: {
  screenW: number;
  top: number;
  children?: ReactNode;
}) {
  return (
    <View
      style={[
        styles.frame,
        { top, left: FrameMargin, width: frameWidth(screenW), height: frameHeight(screenW) },
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
