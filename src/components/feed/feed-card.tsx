import { memo, useContext, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';

import { Image } from 'expo-image';
import { Asset, MediaType } from 'expo-media-library';
import { VideoView, useVideoPlayer } from 'expo-video';

import { FeedCardEventsContext } from '@/components/feed/feed-context';
import { PhotoFrame, type FrameLayout } from '@/components/feed/photo-frame';
import { DisplayFont, FrameMargin, Ink, Paper } from '@/constants/theme';
import { useAssetMetadata, usePlaybackUri } from '@/hooks/use-asset-metadata';
import { useReverseGeocode } from '@/hooks/use-reverse-geocode';
import { formatTimeAgo } from '@/utils/time-ago';

const PLACE_TIMEOUT_MS = 1500;
// Hard cap so a card can never stay invisible (= a white screen) if its image
// somehow reports neither load nor error.
const CARD_VISIBLE_TIMEOUT_MS = 1500;

export const FeedCard = memo(function FeedCard({
  asset,
  isCurrent,
  isActive = true,
  width,
  height,
  frame,
}: {
  asset: Asset;
  isCurrent: boolean;
  isActive?: boolean;
  width: number;
  height: number;
  frame: FrameLayout;
}) {
  const meta = useAssetMetadata(asset);
  const placeName = useReverseGeocode(meta?.location ?? null);
  const isVideo = meta?.mediaType === MediaType.VIDEO;
  const playbackUri = usePlaybackUri(isVideo && isCurrent && isActive ? asset : null);
  // `asset.id` is a loadable URI on both platforms (ph:// on iOS, content:// on
  // Android). The Android file:// path from getInfo() often isn't readable
  // under scoped storage and rendered blank, so don't gate the image on it.
  const thumbnailUri = asset.id;
  const { onCardReady } = useContext(FeedCardEventsContext);

  const [placeTimedOut, setPlaceTimedOut] = useState(false);
  const [imageReady, setImageReady] = useState(false);
  const [safetyVisible, setSafetyVisible] = useState(false);
  // Landscape photos are letterboxed (contain) on #000; everything else fills
  // the 3:4 frame (cover). Determined from the decode since Asset has no dims.
  const [isLandscape, setIsLandscape] = useState(false);

  useEffect(() => {
    setPlaceTimedOut(false);
    if (!meta?.location || placeName) return;
    const t = setTimeout(() => setPlaceTimedOut(true), PLACE_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [meta?.location, placeName]);

  const overlayReady =
    meta != null && (meta.location == null || placeName != null || placeTimedOut);

  // Show the photo as soon as its image is ready — never block visibility on
  // caption metadata. getInfo()/getMediaType() can throw or hang on Android,
  // and gating the whole card on that left it stuck at opacity 0 = a fully
  // white screen. The caption below fades in independently via overlayReady.
  const visible = imageReady || safetyVisible;

  // Safety net: if the image reports neither load nor error, reveal the card
  // anyway so it can't hang white.
  useEffect(() => {
    if (imageReady) return;
    const t = setTimeout(() => setSafetyVisible(true), CARD_VISIBLE_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [imageReady]);

  const opacity = useSharedValue(0);
  const opacityStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  useEffect(() => {
    if (!visible) return;
    opacity.value = 1;
    onCardReady(asset.id);
  }, [visible, opacity, onCardReady, asset.id]);

  const captionTop = frame.top + frame.height + 24;

  return (
    <Animated.View style={[styles.container, { width, height }, opacityStyle]}>
      <PhotoFrame top={frame.top} left={frame.left} width={frame.width} height={frame.height}>
        {thumbnailUri ? (
          <Image
            source={{ uri: thumbnailUri }}
            style={StyleSheet.absoluteFill}
            contentFit={isLandscape ? 'contain' : 'cover'}
            cachePolicy={isCurrent ? 'memory-disk' : 'disk'}
            transition={0}
            recyclingKey={asset.id}
            onLoad={(e) => {
              const { width: w, height: h } = e.source ?? {};
              if (w && h) setIsLandscape(w > h);
              setImageReady(true);
            }}
            onError={() => setImageReady(true)}
          />
        ) : null}
        {isVideo && isCurrent && isActive && playbackUri ? (
          <FeedVideo uri={playbackUri} contain={isLandscape} />
        ) : null}
      </PhotoFrame>

      {overlayReady ? (
        <View
          style={[styles.caption, { top: captionTop, left: FrameMargin, right: FrameMargin }]}
          pointerEvents="none">
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
    </Animated.View>
  );
});

function FeedVideo({ uri, contain }: { uri: string; contain: boolean }) {
  const player = useVideoPlayer(uri, (p) => {
    p.loop = true;
    p.muted = true;
    p.play();
  });

  return (
    <VideoView
      key={uri}
      player={player}
      style={StyleSheet.absoluteFill}
      contentFit={contain ? 'contain' : 'cover'}
      nativeControls={false}
    />
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: Paper,
  },
  caption: {
    position: 'absolute',
    // stretch so the date has the full caption width to auto-fit against
    alignItems: 'stretch',
  },
  date: {
    fontFamily: DisplayFont,
    // Base size for short dates ("TODAY"); adjustsFontSizeToFit shrinks longer
    // ones ("11 YEARS, 364 DAYS AGO") down to one line — never below ~12px,
    // which stays larger than the place.
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
