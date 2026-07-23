import { useEffect, useRef, useState } from 'react';
import {
  AppState,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { type SharedRefType } from 'expo';
import { CameraView, useCameraPermissions, type CameraType } from 'expo-camera';
import { Image } from 'expo-image';
import { ImageManipulator, SaveFormat, type ImageRef } from 'expo-image-manipulator';

import FlipIcon from '@/assets/icons/flip.svg';
import GhostIcon from '@/assets/icons/ghost.svg';
import XIcon from '@/assets/icons/x.svg';
import { FEED_BOTTOM_RESERVE, frameLayout } from '@/components/feed/photo-frame';
import { type CapturedPhoto } from '@/components/recreate/recreation-host';
import { DisplayFont, Ink, Letterbox, Paper } from '@/constants/theme';
import { loadAssetLocation } from '@/hooks/use-asset-metadata';
import { useCurrentLocation } from '@/hooks/use-current-location';
import { withTimeout } from '@/lib/async-safety';
import { getAssetRatio, setAssetRatio } from '@/lib/asset-ratio-cache';
import { type RecreationTarget } from '@/lib/recreation-request';
import { distanceMeters, formatDistanceHint } from '@/utils/distance';

// Ghost overlay opacity steps, cycled by the GHOST button. Starts OFF — the
// ghost is an opt-in alignment aid, not the default view of the camera.
const GHOST_LEVELS = [0, 0.55, 0.3] as const;

const PREVIEW_RADIUS = 18;

// A native capture that neither resolves nor rejects would leave the shutter
// disabled and the preview frozen forever; the timeout re-arms the screen.
const SHUTTER_TIMEOUT_MS = 8000;

// The retake camera, styled like a real camera app: black chrome, a large
// rounded preview, and a white photo-style ring shutter (hollow — a filled
// center reads as a video record button). The preview is still clipped to the
// same 3:4 PhotoRatio rect as the feed (portrait sensor stream is natively
// 4:3), so what you align under the ghost is exactly what the capture and the
// composite will show. The shutter is centered by an absolute wrapper so the
// side controls' label widths can never push it off-center.
export function RecreationCamera({
  target,
  onClose,
  onCaptured,
}: {
  target: RecreationTarget;
  onClose: () => void;
  onCaptured: (photo: CapturedPhoto) => void;
}) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const frame = frameLayout(width, height, insets.top, insets.bottom, FEED_BOTTOM_RESERVE);

  // Contextual permission: primed in-app page first, OS dialog only on the
  // explicit "Enable camera" tap (matching the onboarding prime-then-ask
  // pattern) — never at app launch.
  const [permission, requestPermission, getPermission] = useCameraPermissions();

  // Returning from system Settings (where the user may have just granted
  // camera access) fires 'active'; re-read so the screen unlocks on its own.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') getPermission();
    });
    return () => sub.remove();
  }, [getPermission]);

  const cameraRef = useRef<CameraView>(null);
  const [facing, setFacing] = useState<CameraType>('back');
  const [cameraReady, setCameraReady] = useState(false);
  // Ref guard against double-fire (the state flip lands a frame later).
  const capturing = useRef(false);
  const [captureBusy, setCaptureBusy] = useState(false);

  const [ghostIdx, setGhostIdx] = useState(0);
  const ghostOpacity = GHOST_LEVELS[ghostIdx];

  // Shutter feedback = flash + FREEZE, the normal-camera pattern. The white
  // flash spikes to 1 on the tap and fades; behind it, pausePreview() freezes
  // the preview layer on the tap-moment frame (it only disables the preview
  // connection — the session and the in-flight photo capture are untouched).
  // The frozen frame IS the shot, holding perfectly still until the review
  // crossfades in over it, so there's never live-preview dead time or a
  // blacked-out screen between tap and review. (An earlier version held an
  // opaque black cover here — it read as the app dying, not a shutter.)
  const flashOpacity = useSharedValue(0);
  const flashStyle = useAnimatedStyle(() => ({ opacity: flashOpacity.value }));

  // Ghost fit follows the app-wide rule (cover portrait / contain landscape),
  // seeded from the shared ratio cache and corrected by onLoad — same as the
  // feed's OverlayFramedPhoto.
  const ghostUri = target.asset.id;
  const cachedRatio = getAssetRatio(ghostUri);
  const [loadedLandscape, setLoadedLandscape] = useState(false);
  const ghostLandscape = loadedLandscape || (cachedRatio !== undefined && cachedRatio > 1);

  // Soft proximity hint. useCurrentLocation is read-only (never prompts): no
  // location permission simply means no hint. The old photo's GPS backfills
  // from the deduped metadata loader when the caller didn't have it cached.
  const { state: locState } = useCurrentLocation();
  const [oldLocation, setOldLocation] = useState(target.location);
  useEffect(() => {
    if (target.location) return;
    let cancelled = false;
    loadAssetLocation(target.asset)
      .then((loc) => {
        if (!cancelled && loc) setOldLocation(loc);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [target]);
  const meters =
    locState.status === 'ready' && oldLocation
      ? distanceMeters(locState.coords, oldLocation)
      : null;
  const hint = formatDistanceHint(meters);

  const handleCapture = async () => {
    if (!cameraReady || capturing.current) return;
    capturing.current = true;
    setCaptureBusy(true);
    // Instant shutter feedback on the tap itself: white flash over the frame
    // frozen by pausePreview below (see the comment above).
    flashOpacity.value = 1;
    flashOpacity.value = withTiming(0, { duration: 240 });
    try {
      // pictureRef: the native image handle comes back without the full-res
      // JPEG encode + disk write (that alone was a couple-second stall on the
      // review transition). Orientation is carried by the native image
      // instance, so nothing downstream needs EXIF handling. The file encode
      // runs in the background via `fileUri` below; Save/Share await it.
      // Initiate the capture FIRST, then freeze the preview — pause only
      // disables the preview layer, so the capture completes from the live
      // session either way, but this order keeps the captured moment and the
      // frozen frame the same instant.
      const capture = cameraRef.current?.takePictureAsync({ pictureRef: true });
      cameraRef.current?.pausePreview();
      const pic = capture ? await withTimeout(capture, SHUTTER_TIMEOUT_MS, 'camera capture') : undefined;
      if (pic) {
        let ref: SharedRefType<'image'> = pic;
        let width = pic.width;
        let height = pic.height;
        let flipped: ImageRef | null = null;
        if (facing === 'front') {
          // Un-mirror selfies (Snapchat/BeReal behavior). expo-camera's iOS
          // pipeline leaves the front capture mirrored to match the preview
          // (AVFoundation's automatic mirroring wins over the mirror prop),
          // so flip it back explicitly — in memory, on the ref, no encode. A
          // failed flip falls back to the mirrored original rather than
          // losing the shot.
          try {
            flipped = await withTimeout(
              ImageManipulator.manipulate(pic).flip('horizontal').renderAsync(),
              SHUTTER_TIMEOUT_MS,
              'selfie un-mirror'
            );
            ref = flipped;
            width = flipped.width;
            height = flipped.height;
          } catch {
            // keep the unflipped capture
          }
        }
        // Kick off the tmp-jpg encode now, in the background, so it's long
        // done by the time the user taps Save/Share on the review screen.
        // Memoized single promise; a failure surfaces at the await sites
        // (which alert), the no-op catch just silences the unhandled-
        // rejection warning when the user discards without ever needing it.
        // savePictureAsync quirks: no options — Android floors a fractional
        // quality to 0 (`quality.toInt() * 100`), so the default (max) is the
        // only safe value; and unpatched iOS returns the path under `url`,
        // not the typed `uri` (our expo-camera patch adds `uri`, the fallback
        // covers builds without it).
        const encode = flipped
          ? flipped.saveAsync({ format: SaveFormat.JPEG, compress: 0.9 }).then((r) => r.uri)
          : pic.savePictureAsync().then((r) => {
              const uri = r.uri ?? (r as unknown as { url?: string }).url;
              if (!uri) throw new Error('savePictureAsync returned no uri');
              return uri;
            });
        encode.catch(() => {});
        onCaptured({
          ref,
          width,
          height,
          // Distance at shutter time, carried through to captions/composites.
          distanceM: meters,
          fileUri: () => encode,
        });
        return; // review phase replaces this screen; no need to re-arm
      }
    } catch {
      // fall through and re-arm the shutter
    }
    // Failed/empty capture: unfreeze so the re-armed shutter is live again.
    cameraRef.current?.resumePreview();
    capturing.current = false;
    setCaptureBusy(false);
  };

  const granted = !!permission?.granted;

  return (
    <View style={styles.root}>
      {granted ? (
        <>
          <View
            style={[
              styles.preview,
              {
                top: frame.top,
                left: frame.left,
                width: frame.width,
                height: frame.height,
              },
            ]}>
            <CameraView
              ref={cameraRef}
              style={StyleSheet.absoluteFill}
              facing={facing}
              mode="picture"
              ratio="4:3"
              autofocus="on"
              mirror={false}
              onCameraReady={() => setCameraReady(true)}
            />
            {ghostOpacity > 0 ? (
              <Image
                source={{ uri: ghostUri }}
                style={[StyleSheet.absoluteFill, { opacity: ghostOpacity }]}
                contentFit={ghostLandscape ? 'contain' : 'cover'}
                cachePolicy="memory-disk"
                pointerEvents="none"
                onLoad={(e) => {
                  const { width: w, height: h } = e.source ?? {};
                  if (w && h) {
                    setAssetRatio(ghostUri, w / h);
                    if (w > h) setLoadedLandscape(true);
                  }
                }}
              />
            ) : null}
            {/* Floating distance chip, camera-app style, over the preview. */}
            {hint ? (
              <View style={styles.hintChip} pointerEvents="none">
                <Text style={styles.hintLabel}>{hint}</Text>
              </View>
            ) : null}
            <Animated.View
              style={[styles.flash, flashStyle]}
              pointerEvents="none"
            />
          </View>

          {/* Controls band between the preview bottom and the screen bottom. */}
          <View
            style={[
              styles.band,
              { top: frame.top + frame.height, paddingBottom: insets.bottom },
            ]}
            pointerEvents="box-none">
            <View style={styles.controlsArea} pointerEvents="box-none">
              {/* Absolute center — immune to the side controls' widths. */}
              <View style={styles.shutterWrap} pointerEvents="box-none">
                <Pressable
                  style={({ pressed }) => [
                    styles.shutter,
                    pressed && styles.shutterPressed,
                    (!cameraReady || captureBusy) && styles.shutterBusy,
                  ]}
                  onPress={handleCapture}
                  disabled={!cameraReady || captureBusy}
                />
              </View>
              <View style={styles.sideLeft} pointerEvents="box-none">
                <Pressable
                  style={styles.sideBtn}
                  onPress={() => setGhostIdx((i) => (i + 1) % GHOST_LEVELS.length)}
                  hitSlop={12}>
                  <GhostIcon
                    width={26}
                    height={26}
                    color={Paper}
                    opacity={ghostOpacity > 0 ? 1 : 0.45}
                  />
                  <Text style={styles.sideLabel}>
                    {ghostOpacity > 0 ? `${Math.round(ghostOpacity * 100)}%` : 'OFF'}
                  </Text>
                </Pressable>
              </View>
              <View style={styles.sideRight} pointerEvents="box-none">
                <Pressable
                  style={styles.sideBtn}
                  onPress={() => setFacing((f) => (f === 'back' ? 'front' : 'back'))}
                  hitSlop={12}>
                  <FlipIcon width={26} height={26} color={Paper} />
                  <Text style={styles.sideLabel}>FLIP</Text>
                </Pressable>
              </View>
            </View>
          </View>
        </>
      ) : permission ? (
        <View style={styles.center}>
          <Text style={styles.title}>Camera</Text>
          <Text style={styles.body}>
            {permission.canAskAgain
              ? 'Line up the shot. PastPic uses the camera to retake this photo from the same spot.'
              : 'Camera access is off. Enable it in Settings to retake this photo.'}
          </Text>
          <Pressable
            style={styles.button}
            onPress={() => {
              if (permission.canAskAgain) {
                requestPermission();
              } else {
                Linking.openSettings();
              }
            }}>
            <Text style={styles.buttonLabel}>
              {permission.canAskAgain ? 'Enable camera' : 'Open Settings'}
            </Text>
          </Pressable>
        </View>
      ) : null}

      <SafeAreaView style={styles.topBar} pointerEvents="box-none">
        <Pressable style={styles.closeBtn} onPress={onClose} hitSlop={12}>
          <XIcon width={28} height={28} color={Paper} />
        </Pressable>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Letterbox,
  },
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'flex-start',
    alignItems: 'flex-start',
  },
  closeBtn: {
    marginTop: 2,
    marginLeft: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  preview: {
    position: 'absolute',
    borderRadius: PREVIEW_RADIUS,
    overflow: 'hidden',
    backgroundColor: '#1A1A1A',
  },
  band: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
  },
  // Shutter flash: covers the preview only (the chrome shouldn't blink).
  flash: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: Paper,
  },
  // Floating over the preview, top center — where camera apps put status.
  hintChip: {
    position: 'absolute',
    top: 14,
    alignSelf: 'center',
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  hintLabel: {
    fontFamily: DisplayFont,
    color: Paper,
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  controlsArea: {
    flex: 1,
  },
  shutterWrap: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sideLeft: {
    position: 'absolute',
    left: 28,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'flex-start',
  },
  sideRight: {
    position: 'absolute',
    right: 28,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'flex-end',
  },
  // Icon with a micro-label under it, like camera-app controls.
  sideBtn: {
    padding: 8,
    alignItems: 'center',
    gap: 4,
    minWidth: 52,
  },
  sideLabel: {
    fontFamily: DisplayFont,
    color: Paper,
    fontSize: 10,
    textTransform: 'uppercase',
    opacity: 0.85,
  },
  // Hollow white ring — the classic photo shutter. A filled center is the
  // video-record cue, so the middle stays open on purpose.
  shutter: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 5,
    borderColor: Paper,
  },
  shutterPressed: {
    transform: [{ scale: 0.9 }],
  },
  shutterBusy: {
    opacity: 0.35,
  },
  center: {
    flex: 1,
    backgroundColor: Letterbox,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    paddingHorizontal: 24,
  },
  title: {
    fontFamily: DisplayFont,
    fontSize: 40,
    color: Paper,
    textTransform: 'uppercase',
  },
  body: {
    fontFamily: DisplayFont,
    color: Paper,
    fontSize: 16,
    textAlign: 'center',
    opacity: 0.9,
  },
  button: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 32,
    backgroundColor: Paper,
  },
  buttonLabel: {
    fontFamily: DisplayFont,
    color: Ink,
    fontWeight: '700',
  },
});
