import type { ReactNode } from 'react';
import { ActivityIndicator, Image, StyleSheet, View } from 'react-native';

import { Paper } from '@/constants/theme';

// Just the Polaroid from the logo (no color bands), used as the in-app loading
// indicator and matched to the native splash so the hand-off is seamless.
const POLAROID = require('@/assets/images/polaroid.png');
const ASPECT = 508 / 602; // the cropped asset's width / height
// The native splash (app.json expo-splash-screen) fits the polaroid into a
// square canvas of side `imageWidth`, so on screen the polaroid's TALL dimension
// equals imageWidth and its width is imageWidth * ASPECT. Sizing the in-app one
// identically — same height, same width, same screen-center — means the static
// splash polaroid and this one are pixel-for-pixel the same: no size jump.
const SPLASH_IMAGE_WIDTH = 150; // keep in sync with app.json
const HEIGHT = SPLASH_IMAGE_WIDTH;
const WIDTH = HEIGHT * ASPECT;
// The black photo window's center sits above the polaroid's geometric middle
// (the bottom border is taller). Measured from the asset: center y ≈ 0.408.
const SPINNER_OFFSET_Y = (0.408 - 0.5) * HEIGHT;

// The polaroid and its spinner are both static and present from the first frame
// (no fade-in) — so it never reads as "polaroid first, then a spinner pops in."
// The whole thing is identical to the native splash plus the spinner, so the
// splash → in-app hand-off is seamless.
export function LoadingPolaroid({ note }: { note?: ReactNode } = {}) {
  return (
    <View style={styles.center}>
      <View style={styles.frame}>
        <Image source={POLAROID} style={styles.img} resizeMode="contain" />
        <View style={[StyleSheet.absoluteFill, styles.spinnerWrap]} pointerEvents="none">
          <ActivityIndicator color={Paper} />
        </View>
      </View>
      {note ? <View style={styles.note}>{note}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    backgroundColor: Paper,
    alignItems: 'center',
    justifyContent: 'center',
  },
  frame: {
    width: WIDTH,
    height: HEIGHT,
  },
  img: {
    width: WIDTH,
    height: HEIGHT,
  },
  spinnerWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    transform: [{ translateY: SPINNER_OFFSET_Y }],
  },
  // Sits just below the polaroid; the frame + note center together as a column.
  note: {
    marginTop: 28,
    alignItems: 'center',
  },
});
