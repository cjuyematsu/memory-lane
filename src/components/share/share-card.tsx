import { forwardRef, useEffect, useState } from 'react';
import { PixelRatio, StyleSheet, Text, View } from 'react-native';

import { Image } from 'expo-image';
import { type Asset } from 'expo-media-library';

import { DisplayFont, Ink, Letterbox, Paper, PhotoRatio } from '@/constants/theme';
import { useAssetMetadata } from '@/hooks/use-asset-metadata';
import { useReverseGeocode } from '@/hooks/use-reverse-geocode';
import { computeShareFrame, SHARE_LAYOUT, STORY_CANVAS } from '@/lib/share-memory';
import { formatTimeAgo } from '@/utils/time-ago';

const PLACE_TIMEOUT_MS = 1500;

// The off-screen export view captured by react-native-view-shot. It reproduces
// the Camera Roll feed card (see feed-card.tsx) — white canvas, a fixed 3:4
// `PhotoRatio` frame with the photo cover-cropped to fill it (contain only for
// landscape, letterboxed on black, exactly like the feed), and the date + place
// caption below — onto the fixed 9:16 STORY_CANVAS so the export is a known
// social-ready size. So a shared memory looks just like the feed, minus the
// floating share/shuffle buttons.
//
// Sizing: the canvas is laid out at `canvas.width / pixelRatio` logical points,
// so view-shot's native-scale capture lands at ~canvas.width px (1080) on any
// device — no view-shot resize (which can blank on the New Arch). Everything
// inside is a fraction of the logical canvas, so the composition is identical at
// every resolution. `onReady` fires only once the photo has decoded AND the
// caption has settled, so the host never captures a blank/half frame. Photos
// only (videos share raw), so the image source is always still.
export const ShareCard = forwardRef<View, { asset: Asset; onReady: () => void }>(
  function ShareCard({ asset, onReady }, ref) {
    const canvas = STORY_CANVAS;
    const meta = useAssetMetadata(asset);
    const placeName = useReverseGeocode(meta?.location ?? null);
    // Landscape photos are letterboxed (contain) on black; everything else fills
    // the 3:4 frame (cover) — same rule as the feed card.
    const [isLandscape, setIsLandscape] = useState(false);
    const [imageLoaded, setImageLoaded] = useState(false);
    const [placeTimedOut, setPlaceTimedOut] = useState(false);

    // Don't wait forever on a reverse-geocode: after a beat, settle without a
    // place line (same fallback as the feed card) so capture can proceed.
    useEffect(() => {
      if (!meta?.location || placeName) return;
      const t = setTimeout(() => setPlaceTimedOut(true), PLACE_TIMEOUT_MS);
      return () => clearTimeout(t);
    }, [meta?.location, placeName]);

    const placeReady =
      meta != null && (meta.location == null || placeName != null || placeTimedOut);
    const ready = imageLoaded && meta != null && placeReady;

    useEffect(() => {
      if (ready) onReady();
    }, [ready, onReady]);

    // Logical canvas: target px scaled down by the device's pixel ratio, so the
    // native-resolution capture comes out at ~canvas.width px regardless of device.
    const scale = PixelRatio.get();
    const canvasW = Math.round(canvas.width / scale);
    const canvasH = Math.round(canvasW / canvas.aspect);

    // Always a 3:4 PhotoRatio box (like the feed); the photo fills it via
    // contentFit, so the frame shape doesn't depend on the photo's own ratio.
    const { frameW, frameH } = computeShareFrame(canvasW, canvasH, PhotoRatio);
    const border = canvasW * SHARE_LAYOUT.borderFrac;
    const captionGap = canvasW * SHARE_LAYOUT.captionGapFrac;
    const dateFont = canvasW * SHARE_LAYOUT.dateFontFrac;
    const placeFont = canvasW * SHARE_LAYOUT.placeFontFrac;
    const captionPad = canvasW * SHARE_LAYOUT.marginFrac;
    // Bottom padding pushes the vertically-centered block upward by ≈half of it,
    // so the photo sits above center with a roomier, grounded bottom margin.
    const lift = canvasH * SHARE_LAYOUT.liftFrac;

    return (
      <View
        ref={ref}
        collapsable={false}
        style={[styles.card, { width: canvasW, height: canvasH, paddingBottom: lift }]}>
        <View
          style={[
            styles.frame,
            { width: frameW, height: frameH, borderWidth: border },
          ]}>
          <Image
            source={{ uri: asset.id }}
            style={StyleSheet.absoluteFill}
            contentFit={isLandscape ? 'contain' : 'cover'}
            cachePolicy="memory-disk"
            transition={0}
            onLoad={(e) => {
              const { width: w, height: h } = e.source ?? {};
              if (w && h) setIsLandscape(w > h);
              setImageLoaded(true);
            }}
            onError={() => setImageLoaded(true)}
          />
        </View>

        {meta ? (
          <View
            style={[
              styles.caption,
              { marginTop: captionGap, paddingHorizontal: captionPad },
            ]}>
            <Text
              style={[styles.date, { fontSize: dateFont }]}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.4}>
              {formatTimeAgo(meta.creationTime)}
            </Text>
            {placeName ? (
              <Text
                style={[
                  styles.place,
                  {
                    fontSize: placeFont,
                    lineHeight: placeFont * 1.45,
                    marginTop: placeFont * 0.9,
                  },
                ]}>
                {placeName}
              </Text>
            ) : null}
          </View>
        ) : null}
      </View>
    );
  }
);

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
});
