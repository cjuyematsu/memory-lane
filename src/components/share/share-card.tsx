import { forwardRef, useEffect, useState } from 'react';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { Image } from 'expo-image';
import { type Asset } from 'expo-media-library';

import { DisplayFont, Ink, Letterbox, Paper, PhotoRatio } from '@/constants/theme';
import { useAssetMetadata } from '@/hooks/use-asset-metadata';
import { useReverseGeocode } from '@/hooks/use-reverse-geocode';
import { formatTimeAgo } from '@/utils/time-ago';

// Side gutter / breathing room around the framed photo on the export canvas. A
// touch wider than the in-app FrameMargin so the shared image reads as an
// intentional gallery print rather than an edge-to-edge screenshot.
const SHARE_MARGIN = 28;
const PLACE_TIMEOUT_MS = 1500;
// Cap how tall the frame may get, matching the Near Me viewer: a photo taller
// than this is widened to the cap and cover-cropped instead of becoming a
// width-wasting sliver. Everything at this ratio or wider keeps its exact shape.
const MIN_FRAME_RATIO = 2 / 3;

// The off-screen export view captured by react-native-view-shot. It renders the
// same gallery look as the feed/viewer — white canvas, Letterbox-bordered
// framed photo, date + place caption below — at the device width, and calls
// `onReady` only once the photo has decoded AND the caption has settled, so the
// host never captures a blank frame or a half-resolved caption. Photos only
// (videos share raw), so the image source is always still.
export const ShareCard = forwardRef<View, { asset: Asset; onReady: () => void }>(
  function ShareCard({ asset, onReady }, ref) {
    const { width } = useWindowDimensions();
    const meta = useAssetMetadata(asset);
    const placeName = useReverseGeocode(meta?.location ?? null);
    const [ratio, setRatio] = useState<number | null>(null);
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

    const frameW = width - 2 * SHARE_MARGIN;
    const realR = ratio ?? PhotoRatio;
    const r = Math.max(realR, MIN_FRAME_RATIO);
    const cropped = realR < MIN_FRAME_RATIO;
    const frameH = frameW / r;

    return (
      <View ref={ref} collapsable={false} style={[styles.card, { width }]}>
        <View style={[styles.frame, { width: frameW, height: frameH }]}>
          <Image
            source={{ uri: asset.id }}
            style={StyleSheet.absoluteFill}
            contentFit={cropped ? 'cover' : 'contain'}
            cachePolicy="memory-disk"
            transition={0}
            onLoad={(e) => {
              const { width: w, height: h } = e.source ?? {};
              if (w && h) setRatio(w / h);
              setImageLoaded(true);
            }}
            onError={() => setImageLoaded(true)}
          />
        </View>

        {meta ? (
          <View style={styles.caption}>
            <Text
              style={styles.date}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.4}>
              {formatTimeAgo(meta.creationTime)}
            </Text>
            {placeName ? <Text style={styles.place}>{placeName}</Text> : null}
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
    paddingVertical: 36,
  },
  frame: {
    borderWidth: 10,
    borderColor: Letterbox,
    backgroundColor: Letterbox,
    overflow: 'hidden',
  },
  caption: {
    alignSelf: 'stretch',
    alignItems: 'center',
    paddingHorizontal: SHARE_MARGIN,
    marginTop: 22,
  },
  date: {
    fontFamily: DisplayFont,
    fontSize: 30,
    color: Ink,
    textTransform: 'uppercase',
    textAlign: 'center',
  },
  place: {
    fontFamily: DisplayFont,
    fontSize: 11,
    lineHeight: 16,
    color: Ink,
    textTransform: 'uppercase',
    textAlign: 'center',
    letterSpacing: 0.5,
    marginTop: 10,
  },
});
