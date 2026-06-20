import { type ReactNode } from 'react';
import { StyleSheet, type LayoutChangeEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

const DEFAULT_MAX_SCALE = 4;
const RESET = { duration: 200, easing: Easing.out(Easing.cubic) };

// Pinch-to-zoom "peek": two fingers zoom toward the focal point and pan while held,
// release springs back to 1×. It never persists a zoomed state, so it stays out of
// the way of the 1-finger pager/dismiss/tab gestures around it. The companion pan is
// `minPointers(2)`, so it only ever claims a deliberate two-finger drag. Callers gate
// their own scroll/dismiss gestures off via `onActiveChange` for the duration.
export function PinchZoom({
  children,
  maxScale = DEFAULT_MAX_SCALE,
  onActiveChange,
}: {
  children: ReactNode;
  maxScale?: number;
  onActiveChange?: (active: boolean) => void;
}) {
  const scale = useSharedValue(1);
  const focalX = useSharedValue(0);
  const focalY = useSharedValue(0);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  // Captured from onLayout so the focal math works at any frame size without the
  // caller having to pass dimensions.
  const vw = useSharedValue(0);
  const vh = useSharedValue(0);

  const onLayout = (e: LayoutChangeEvent) => {
    vw.value = e.nativeEvent.layout.width;
    vh.value = e.nativeEvent.layout.height;
  };

  const settle = () => {
    'worklet';
    scale.value = withTiming(1, RESET);
    translateX.value = withTiming(0, RESET);
    translateY.value = withTiming(0, RESET);
  };

  const pinch = Gesture.Pinch()
    .onStart((e) => {
      focalX.value = e.focalX;
      focalY.value = e.focalY;
      if (onActiveChange) scheduleOnRN(onActiveChange, true);
    })
    .onUpdate((e) => {
      scale.value = Math.min(Math.max(e.scale, 1), maxScale);
    })
    // onFinalize, not onEnd: it fires on end/fail/cancel alike (and even if the
    // view unmounts mid-pinch), so the parent's zoom gate can never get wedged
    // open — which would freeze the pager / dismiss / tab-swipe gestures.
    .onFinalize(() => {
      settle();
      if (onActiveChange) scheduleOnRN(onActiveChange, false);
    });

  // Two-finger drag moves the zoomed image. `minPointers(2)` keeps it from ever
  // competing with the surrounding single-finger gestures.
  const pan = Gesture.Pan()
    .minPointers(2)
    .averageTouches(true)
    .onUpdate((e) => {
      translateX.value = e.translationX;
      translateY.value = e.translationY;
    })
    .onFinalize(() => {
      translateX.value = withTiming(0, RESET);
      translateY.value = withTiming(0, RESET);
    });

  const gesture = Gesture.Simultaneous(pinch, pan);

  // Anchor the zoom on the focal point. RN transforms originate at the view center,
  // so a point f stays put under scale s by adding (1 - s)·(f - center). As scale
  // returns to 1 on release, that term and the pan offset both fall to 0 — a clean
  // spring-back with nothing else to animate.
  const animatedStyle = useAnimatedStyle(() => {
    const cx = vw.value / 2;
    const cy = vh.value / 2;
    return {
      transform: [
        { translateX: translateX.value + (1 - scale.value) * (focalX.value - cx) },
        { translateY: translateY.value + (1 - scale.value) * (focalY.value - cy) },
        { scale: scale.value },
      ],
    };
  });

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View style={[StyleSheet.absoluteFill, animatedStyle]} onLayout={onLayout}>
        {children}
      </Animated.View>
    </GestureDetector>
  );
}
