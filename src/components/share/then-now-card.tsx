import { forwardRef, useEffect, useState } from 'react';
import { PixelRatio, StyleSheet, Text, View } from 'react-native';

import { Image, type ImageLoadEventData } from 'expo-image';

import { DisplayFont, Ink, Letterbox, Paper, PhotoRatio } from '@/constants/theme';
import { useReverseGeocode } from '@/hooks/use-reverse-geocode';
import { isPlaceholderLoad } from '@/lib/image-load-event';
import {
  computeShareFrame,
  computeThenNowInset,
  SHARE_LAYOUT,
  STORY_CANVAS,
  type ThenNowShare,
  type ThenNowVariant,
} from '@/lib/share-memory';
import { formatDistanceShort } from '@/utils/distance';
import { formatTimeAgo } from '@/utils/time-ago';

const PLACE_TIMEOUT_MS = 1500;

// The off-screen then/now export captured by react-native-view-shot, BeReal
// style: the primary photo with the other as a small white-bordered inset in
// the top-left corner (`thenNow.primary` decides which is which — whatever
// arrangement the user had showing is what exports). Two variants:
//
//  - 'clean' (default): the 3:4 photo itself, no canvas — just the inset and
//    a small on-photo chip with the date + how far from the original spot the
//    retake happened. Exports at 1080×1440.
//  - 'framed': the app's 9:16 white story canvas with the same composition as
//    the single-photo ShareCard (computeShareFrame + SHARE_LAYOUT, date line,
//    distance + place sub-line).
//
// Clones ShareCard's capture-safety skeleton exactly: laid out at
// `canvas.width / pixelRatio` logical points (so the native-scale capture
// lands at ~1080px without a view-shot resize, which can blank on the New
// Arch), opaque, `collapsable={false}`.
//
// Captions come from the persisted ThenNowShare fields, never a metadata hook
// — gallery re-shares must work after caches are cold and even after the
// original library asset is gone (the then side then degrades: labeled panel
// when it's the big photo, quietly dropped when it's the inset).
export const ThenNowCard = forwardRef<
  View,
  { thenNow: ThenNowShare; variant: ThenNowVariant; onReady: () => void }
>(function ThenNowCard({ thenNow, variant, onReady }, ref) {
  // The framed variant resolves a place name; the clean chip does not.
  const placeName = useReverseGeocode(
    variant === 'framed' ? thenNow.oldLocation : null
  );

  // The then image settles on a FINAL load only: the patched opportunistic
  // ph:// delivery fires onLoad for the degraded blurred placeholder first,
  // and capturing that would ship a blurry composite (see lib/image-load-event
  // and CLAUDE.md). A load failure settles too — degraded, not blocking.
  const [thenSettled, setThenSettled] = useState(false);
  const [thenFailed, setThenFailed] = useState(false);
  const [thenLandscape, setThenLandscape] = useState(false);
  const [nowLoaded, setNowLoaded] = useState(false);
  const [placeTimedOut, setPlaceTimedOut] = useState(false);

  // Same bound as ShareCard: don't hold the capture forever on a slow
  // reverse-geocode; settle without the place line.
  useEffect(() => {
    if (variant !== 'framed' || !thenNow.oldLocation || placeName) return;
    const t = setTimeout(() => setPlaceTimedOut(true), PLACE_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [variant, thenNow.oldLocation, placeName]);

  const placeReady =
    variant !== 'framed' ||
    thenNow.oldLocation == null ||
    placeName != null ||
    placeTimedOut;
  // The now photo is our own file and half the point of the card, so a failure
  // there does NOT settle — the host's capture timeout surfaces a friendly
  // error instead of sharing a half-empty composite.
  const ready = thenSettled && nowLoaded && placeReady;

  useEffect(() => {
    if (ready) onReady();
  }, [ready, onReady]);

  // Logical canvas: target px scaled down by the device's pixel ratio, so the
  // native-resolution capture comes out at ~1080px wide on any device.
  const scale = PixelRatio.get();
  const canvasW = Math.round(STORY_CANVAS.width / scale);
  const canvasH =
    variant === 'clean'
      ? Math.round(canvasW / PhotoRatio) // the photo IS the canvas (3:4)
      : Math.round(canvasW / STORY_CANVAS.aspect);

  // Framed composition (identical to ShareCard); the clean variant fills.
  const { frameW, frameH } =
    variant === 'framed'
      ? computeShareFrame(canvasW, canvasH, PhotoRatio)
      : { frameW: canvasW, frameH: canvasH };
  const border = variant === 'framed' ? canvasW * SHARE_LAYOUT.borderFrac : 0;
  const captionGap = canvasW * SHARE_LAYOUT.captionGapFrac;
  const dateFont = canvasW * SHARE_LAYOUT.dateFontFrac;
  const subFont = canvasW * SHARE_LAYOUT.placeFontFrac;
  const captionPad = canvasW * SHARE_LAYOUT.marginFrac;
  const lift = variant === 'framed' ? canvasH * SHARE_LAYOUT.liftFrac : 0;
  const inset = computeThenNowInset(frameW, PhotoRatio);
  const chipFont = canvasW * 0.03;

  const bigIsThen = thenNow.primary === 'then';
  const bigUri = bigIsThen ? thenNow.oldAssetId : thenNow.newPhotoUri;
  const insetUri = bigIsThen ? thenNow.newPhotoUri : thenNow.oldAssetId;
  const insetIsThen = !bigIsThen;

  const onThenLoad = (e: ImageLoadEventData) => {
    const { width: w, height: h } = e.source ?? {};
    if (w && h) setThenLandscape(w > h);
    if (!isPlaceholderLoad(e)) setThenSettled(true);
  };
  const onThenError = () => {
    setThenFailed(true);
    setThenSettled(true);
  };
  const onNowLoad = () => setNowLoaded(true);

  const dateLabel = formatTimeAgo(thenNow.oldCreationTime);
  const distanceLabel = formatDistanceShort(thenNow.capturedDistanceM);
  const chipLabel = [dateLabel, distanceLabel].filter(Boolean).join(' · ');
  const framedSub = [distanceLabel, placeName].filter(Boolean).join(' · ');

  return (
    <View
      ref={ref}
      collapsable={false}
      style={[styles.card, { width: canvasW, height: canvasH, paddingBottom: lift }]}>
      <View
        style={[styles.frame, { width: frameW, height: frameH, borderWidth: border }]}>
        {bigIsThen && thenFailed ? (
          <View style={styles.missing}>
            <Text style={[styles.missingLabel, { fontSize: subFont }]}>
              Original photo is no longer in your library
            </Text>
          </View>
        ) : (
          <Image
            source={{ uri: bigUri }}
            style={StyleSheet.absoluteFill}
            contentFit={bigIsThen && thenLandscape ? 'contain' : 'cover'}
            cachePolicy="memory-disk"
            transition={0}
            onLoad={bigIsThen ? onThenLoad : onNowLoad}
            onError={bigIsThen ? onThenError : undefined}
          />
        )}

        {!(insetIsThen && thenFailed) ? (
          <View
            style={[
              styles.inset,
              {
                left: inset.margin,
                top: inset.margin,
                width: inset.width,
                height: inset.height,
                borderWidth: inset.border,
                borderRadius: inset.radius,
              },
            ]}>
            <Image
              source={{ uri: insetUri }}
              style={StyleSheet.absoluteFill}
              contentFit="cover"
              cachePolicy="memory-disk"
              transition={0}
              onLoad={insetIsThen ? onThenLoad : onNowLoad}
              onError={insetIsThen ? onThenError : undefined}
            />
            {/* One-word disambiguation, scaled to the inset (mirrors the
                on-screen preview's tag so the export matches what was seen). */}
            <View
              style={[
                styles.insetTag,
                {
                  bottom: inset.margin * 0.45,
                  borderRadius: inset.width * 0.065,
                  paddingHorizontal: inset.width * 0.055,
                  paddingVertical: inset.width * 0.018,
                },
              ]}>
              <Text
                style={[styles.insetTagLabel, { fontSize: Math.max(8, inset.width * 0.075) }]}>
                {insetIsThen ? 'Then' : 'Now'}
              </Text>
            </View>
          </View>
        ) : null}

        {variant === 'clean' && chipLabel ? (
          <View style={[styles.chip, { bottom: inset.margin }]} pointerEvents="none">
            <Text style={[styles.chipLabel, { fontSize: chipFont }]} numberOfLines={1}>
              {chipLabel}
            </Text>
          </View>
        ) : null}
      </View>

      {variant === 'framed' ? (
        <View
          style={[styles.caption, { marginTop: captionGap, paddingHorizontal: captionPad }]}>
          <Text
            style={[styles.date, { fontSize: dateFont }]}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.4}>
            {dateLabel}
          </Text>
          {framedSub ? (
            <Text
              style={[
                styles.place,
                {
                  fontSize: subFont,
                  lineHeight: subFont * 1.45,
                  marginTop: subFont * 0.9,
                },
              ]}>
              {framedSub}
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  card: {
    backgroundColor: Paper,
    alignItems: 'center',
    justifyContent: 'center',
  },
  frame: {
    borderColor: Letterbox,
    backgroundColor: Letterbox,
    overflow: 'hidden',
  },
  inset: {
    position: 'absolute',
    borderColor: Paper,
    overflow: 'hidden',
    backgroundColor: Letterbox,
  },
  insetTag: {
    position: 'absolute',
    alignSelf: 'center',
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  insetTagLabel: {
    fontFamily: DisplayFont,
    color: Paper,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  // Small on-photo tag (clean variant): date + distance on a soft dark pill,
  // centered near the bottom — the story travels with the image.
  chip: {
    position: 'absolute',
    alignSelf: 'center',
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 7,
    maxWidth: '86%',
  },
  chipLabel: {
    fontFamily: DisplayFont,
    color: Paper,
    textTransform: 'uppercase',
    textAlign: 'center',
    letterSpacing: 0.5,
  },
  caption: {
    alignSelf: 'stretch',
    alignItems: 'center',
  },
  date: {
    fontFamily: DisplayFont,
    color: Ink,
    textTransform: 'uppercase',
    textAlign: 'center',
  },
  place: {
    fontFamily: DisplayFont,
    color: Ink,
    textTransform: 'uppercase',
    textAlign: 'center',
    letterSpacing: 0.5,
  },
  missing: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  missingLabel: {
    fontFamily: DisplayFont,
    color: Paper,
    textAlign: 'center',
    textTransform: 'uppercase',
    opacity: 0.8,
  },
});
