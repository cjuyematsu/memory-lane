import { useCallback, useEffect, useState } from 'react';
import { BackHandler, StyleSheet, useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  FadeIn,
  FadeOut,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { type SharedRefType } from 'expo';
import { StatusBar } from 'expo-status-bar';

import { RecreationCamera } from '@/components/recreate/recreation-camera';
import { RecreationReview } from '@/components/recreate/recreation-review';
import { Letterbox } from '@/constants/theme';
import {
  closeRecreation,
  useRecreationTarget,
  type RecreationTarget,
} from '@/lib/recreation-request';

// How far the sheet must travel (or how fast) before a downward swipe commits
// to dismissing the camera.
const DISMISS_DISTANCE = 130;
const DISMISS_VELOCITY = 900;

const ENTER_TIMING = { duration: 320, easing: Easing.out(Easing.cubic) };
const EXIT_TIMING = { duration: 230, easing: Easing.in(Easing.cubic) };

// The retaken photo as handed back by the camera. `ref` is the native image
// instance (expo SharedRef) delivered by takePictureAsync({ pictureRef: true })
// — it renders directly in expo-image, which is what lets the review appear
// the moment the shutter fires instead of after a full-res JPEG encode.
// `fileUri()` resolves the tmp jpg (encode kicked off in the background at
// capture time, memoized), which Save/Share await; it only becomes durable if
// the user explicitly Saves on the review screen. distanceM = how far from
// the original photo's spot the shutter was pressed (null when either fix was
// unavailable).
export type CapturedPhoto = {
  ref: SharedRefType<'image'>;
  width: number;
  height: number;
  distanceM: number | null;
  fileUri: () => Promise<string>;
};

// Root-mounted full-screen overlay (see app/_layout.tsx) driving the photo
// recreation flow: camera-with-ghost → review (Retake / Share / Save).
// Renderless until a target is requested, and unmounts completely on close so
// the CameraView never lingers (only one active camera preview is allowed).
// Mounted as a later sibling of <Slot/> so it stacks above everything inside
// TopTabs (including the Near Me viewer); TopTabs additionally disables its
// tab-swipe gesture while a target is open, since RNGH receives touches
// independent of overlay coverage on Android.
//
// The whole flow dismisses on swipe-down (the standard camera-sheet gesture).
// On the review phase that discards an unsaved capture, but the commit
// threshold (130px of deliberate downward travel, or a fast fling) plus the
// downward-only activation offset make a stray discard unlikely, and Retake
// is one tap if it happens.
export function RecreationHost() {
  const target = useRecreationTarget();
  const [phase, setPhase] = useState<'camera' | 'review'>('camera');
  const [captured, setCaptured] = useState<CapturedPhoto | null>(null);
  // Previous request, tracked in state so the reset below is a pure
  // set-state-during-render (React's supported "reset on prop change" pattern
  // — see ShareHost), not a setState-in-effect.
  const [prevTarget, setPrevTarget] = useState<RecreationTarget | null>(null);
  if (target !== prevTarget) {
    setPrevTarget(target);
    if (phase !== 'camera') setPhase('camera');
    if (captured !== null) setCaptured(null);
  }

  const { height: screenH } = useWindowDimensions();
  const translateY = useSharedValue(0);

  // Slide the sheet up on every new request.
  useEffect(() => {
    if (!target) return;
    translateY.value = screenH;
    translateY.value = withTiming(0, ENTER_TIMING);
  }, [target, screenH, translateY]);

  // Every close path (X, hardware back, swipe commit, post-save) slides the
  // sheet out before unmounting, mirroring the slide-up entrance. No dedupe
  // guard needed: closeRecreation is idempotent and re-running the timing to
  // the same destination is harmless.
  const animateClose = useCallback(() => {
    translateY.value = withTiming(screenH, EXIT_TIMING, () => {
      'worklet';
      scheduleOnRN(closeRecreation);
    });
  }, [screenH, translateY]);

  // Android hardware back mirrors the on-screen navigation instead of
  // backgrounding the app: review steps back to the camera, camera closes.
  useEffect(() => {
    if (!target) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (phase === 'review') {
        setCaptured(null);
        setPhase('camera');
      } else {
        animateClose();
      }
      return true;
    });
    return () => sub.remove();
  }, [target, phase, animateClose]);

  const dismissPan = Gesture.Pan()
    // Positive-only offset: activate on downward travel, never sideways/up.
    .activeOffsetY(24)
    .failOffsetX([-24, 24])
    .onUpdate((e) => {
      translateY.value = Math.max(0, e.translationY);
    })
    .onEnd((e) => {
      if (e.translationY > DISMISS_DISTANCE || e.velocityY > DISMISS_VELOCITY) {
        // Continue the slide from wherever the finger left it, then unmount.
        translateY.value = withTiming(screenH, EXIT_TIMING, () => {
          'worklet';
          scheduleOnRN(closeRecreation);
        });
      } else {
        translateY.value = withTiming(0, { duration: 180 });
      }
    });

  const slideStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));
  // The black backdrop fades with the slide so the app resurfaces underneath.
  const backdropStyle = useAnimatedStyle(() => ({
    opacity: interpolate(translateY.value, [0, screenH], [1, 0]),
  }));

  if (!target) return null;

  return (
    <View style={styles.root}>
      {/* Camera + review are dark chrome; flip the status bar while open
          (expo-status-bar is stack-based, so unmounting restores the app's). */}
      <StatusBar style="light" />
      <Animated.View style={[styles.backdrop, backdropStyle]} pointerEvents="none" />
      <GestureDetector gesture={dismissPan}>
        <Animated.View style={[styles.sheet, slideStyle]}>
          {/* Camera ⇄ review crossfade: a hard conditional swap made the
              review pop onto the screen the frame the capture resolved, which
              read as a jerk right after the shutter flash. The outgoing phase
              fades out while the incoming fades in (both sit on the same
              Letterbox black, so the blend is seamless); the exiting camera
              lingering ~150ms with a live CameraView is harmless — capture is
              already done and the host still unmounts everything on close. */}
          {phase === 'review' && captured ? (
            <Animated.View
              style={styles.phase}
              entering={FadeIn.duration(200)}
              exiting={FadeOut.duration(150)}>
              <RecreationReview
                target={target}
                photo={captured}
                onRetake={() => {
                  setCaptured(null);
                  setPhase('camera');
                }}
                onDone={animateClose}
              />
            </Animated.View>
          ) : (
            <Animated.View
              style={styles.phase}
              entering={FadeIn.duration(200)}
              exiting={FadeOut.duration(150)}>
              <RecreationCamera
                target={target}
                onClose={animateClose}
                onCaptured={(photo) => {
                  setCaptured(photo);
                  setPhase('review');
                }}
              />
            </Animated.View>
          )}
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    // Above the app content (TopTabs overlays use zIndex ≤ 20 inside the Slot
    // subtree), below the global MemoryBanner (100) and boot loader (200).
    zIndex: 50,
  },
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: Letterbox,
  },
  sheet: {
    flex: 1,
    backgroundColor: Letterbox,
  },
  phase: {
    flex: 1,
  },
});
