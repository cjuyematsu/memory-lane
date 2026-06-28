import { memo, useContext, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, StyleSheet, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { Image } from 'expo-image';
import { Asset, MediaType } from 'expo-media-library';
import { VideoView, useVideoPlayer } from 'expo-video';

import { FeedCardEventsContext } from '@/components/feed/feed-context';
import { PhotoFrame, type FrameLayout } from '@/components/feed/photo-frame';
import { PinchZoom } from '@/components/pinch-zoom';
import { DisplayFont, FrameMargin, Ink, Paper } from '@/constants/theme';
import { useAssetMetadata, usePlaybackUri } from '@/hooks/use-asset-metadata';
import { useReverseGeocode } from '@/hooks/use-reverse-geocode';
import { getAssetRatio, setAssetRatio } from '@/lib/asset-ratio-cache';
import { formatTimeAgo } from '@/utils/time-ago';

const PLACE_TIMEOUT_MS = 1500;
// Hard cap so a card can never stay invisible (= a white screen) if its image
// somehow reports neither load nor error.
const CARD_VISIBLE_TIMEOUT_MS = 1500;
// After this long still loading, surface "Loading from iCloud…" under the
// spinner so a slow offloaded-photo download reads as working, not frozen.
const ICLOUD_HINT_DELAY_MS = 2500;

export const FeedCard = memo(function FeedCard({
  asset,
  isCurrent,
  isActive = true,
  priority = 'normal',
  width,
  height,
  frame,
  onZoomChange,
}: {
  asset: Asset;
  isCurrent: boolean;
  isActive?: boolean;
  // Decode/download priority, driven by how close this card is to the one in
  // view: the focused photo and its immediate neighbors outrank the rest so they
  // win the iCloud download queue on an offloaded library.
  priority?: 'low' | 'normal' | 'high';
  width: number;
  height: number;
  frame: FrameLayout;
  onZoomChange?: (active: boolean) => void;
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

  // Keyed by asset id so a recycled/changed card derives a fresh "not timed
  // out" without a state reset in the effect body.
  const [timedOutId, setTimedOutId] = useState<string | null>(null);
  const placeTimedOut = timedOutId === asset.id;
  const [imageReady, setImageReady] = useState(false);
  const [safetyVisible, setSafetyVisible] = useState(false);
  // Keyed by asset id (like timedOutId) so a recycled card resets without a
  // setState in the effect body. True once a still-loading card has waited long
  // enough that it's clearly an iCloud download.
  const [slowLoadId, setSlowLoadId] = useState<string | null>(null);
  const slowLoad = slowLoadId === asset.id && !imageReady;
  // Landscape photos are letterboxed (contain) on #000; everything else fills
  // the 3:4 frame (cover). The Asset has no dims, so we SEED orientation from the
  // shared ratio cache (populated as photos load here + in the Near Me grid) — a
  // previously-seen photo opens in the right fit immediately instead of flashing
  // a zoomed `cover` frame before its own decode corrects it (the shuffle zoom).
  // Falls back to this card's own onLoad for a never-before-seen photo. Keyed by
  // asset id (like timedOutId) so a recycled card re-derives without an effect.
  const cachedRatio = getAssetRatio(asset.id);
  const [loadedLandscapeId, setLoadedLandscapeId] = useState<string | null>(null);
  const isLandscape =
    loadedLandscapeId === asset.id || (cachedRatio !== undefined && cachedRatio > 1);

  useEffect(() => {
    if (!meta?.location || placeName) return;
    const t = setTimeout(() => setTimedOutId(asset.id), PLACE_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [meta?.location, placeName, asset.id]);

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

  // If a card is still loading after a beat, it's almost certainly downloading
  // from iCloud — surface that under the spinner so it doesn't read as frozen.
  useEffect(() => {
    if (imageReady) return;
    const t = setTimeout(() => setSlowLoadId(asset.id), ICLOUD_HINT_DELAY_MS);
    return () => clearTimeout(t);
  }, [imageReady, asset.id]);

  const opacity = useSharedValue(0);
  const opacityStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  useEffect(() => {
    if (visible) opacity.value = 1;
  }, [visible, opacity]);

  // The caption (date + place) becomes ready independently of the photo — often
  // a beat after it, once metadata resolves — so fade it in on its own opacity
  // rather than letting it pop in over the already-visible photo.
  const captionOpacity = useSharedValue(0);
  const captionStyle = useAnimatedStyle(() => ({ opacity: captionOpacity.value }));

  useEffect(() => {
    if (overlayReady) captionOpacity.value = withTiming(1, { duration: 280 });
  }, [overlayReady, captionOpacity]);

  // Announce readiness only as the current card (re-announcing when becoming
  // current, since a shuffle can land on an already-loaded card whose state
  // never flips again), and only on a real image result (load or error) — not
  // on the safety-visibility timeout. The feed holds its crossfade overlay
  // and the shuffle gate on this signal; announcing a bare frame made the
  // overlay reveal exactly that.
  useEffect(() => {
    if (imageReady && isCurrent) onCardReady(asset.id);
  }, [imageReady, isCurrent, onCardReady, asset.id]);

  const captionTop = frame.top + frame.height + 24;

  return (
    <Animated.View style={[styles.container, { width, height }, opacityStyle]}>
      <PhotoFrame top={frame.top} left={frame.left} width={frame.width} height={frame.height}>
        <PinchZoom onActiveChange={onZoomChange}>
          {thumbnailUri ? (
            <Image
              source={{ uri: thumbnailUri }}
              style={StyleSheet.absoluteFill}
              contentFit={isLandscape ? 'contain' : 'cover'}
              cachePolicy={isCurrent ? 'memory-disk' : 'disk'}
              priority={priority}
              // Gentle blur→sharp focus-in. The expo-image patch makes this
              // transition run ONLY when replacing an already-shown frame (the
              // sharp full image over the soft-blurred opportunistic one), never on
              // first display — so it can't fade over the black frame or animate
              // the contentFit, the two things that caused the earlier flash/zoom.
              // The first frame still appears instantly.
              transition={220}
              recyclingKey={asset.id}
              onLoad={(e) => {
                const { width: w, height: h } = e.source ?? {};
                if (w && h) {
                  // Record the ratio so the shuffle-exit overlay (and later views)
                  // can seed the right fit and never flash a zoom.
                  setAssetRatio(asset.id, w / h);
                  if (w > h) setLoadedLandscapeId(asset.id);
                }
                setImageReady(true);
              }}
              onError={() => setImageReady(true)}
            />
          ) : null}
          {isVideo && isCurrent && isActive && playbackUri ? (
            <FeedVideo uri={playbackUri} contain={isLandscape} />
          ) : null}
          {/* Only ever seen when the safety timeout reveals the card before its
              image decoded (slow iCloud loads) — a bare black frame otherwise. */}
          {!imageReady ? (
            <View style={styles.loading} pointerEvents="none">
              <ActivityIndicator color={Paper} />
              {slowLoad ? <Text style={styles.loadingText}>Loading from iCloud…</Text> : null}
            </View>
          ) : null}
        </PinchZoom>
      </PhotoFrame>

      {overlayReady ? (
        <Animated.View
          style={[
            styles.caption,
            captionStyle,
            { top: captionTop, left: FrameMargin, right: FrameMargin },
          ]}
          pointerEvents="none">
          <Text
            style={styles.date}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.4}>
            {formatTimeAgo(meta.creationTime)}
          </Text>
          {placeName ? <Text style={styles.place}>{placeName}</Text> : null}
        </Animated.View>
      ) : null}
    </Animated.View>
  );
});

function FeedVideo({ uri, contain }: { uri: string; contain: boolean }) {
  const player = useVideoPlayer(uri, (p) => {
    p.loop = true;
    p.muted = true;
    // Mix with other apps' audio so a (muted) video never interrupts the
    // user's background music. The default 'auto' still interrupts here.
    p.audioMixingMode = 'mixWithOthers';
    p.play();
  });

  // Backgrounding the app leaves the player's AVPlayerItem stalled, so on return
  // the video sits frozen on the last frame (play() resumes audio only). On a
  // real background→foreground we reload the source — replaceAsync, the required
  // path for the ph:// PHAsset URIs we pass — which rebuilds a live item and
  // render surface in place, then play. We deliberately do NOT remount the
  // VideoView: an earlier key-bump did, but tearing the view down and back up
  // read as a jerky flash; reloading the item on the still-mounted view is
  // smoother. Restarts the clip from the top (fine here: muted + looping). The
  // explicit "was backgrounded" flag keeps benign inactive→active blips (Control
  // Center, a notification) from reloading.
  const wasBackgrounded = useRef(false);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'background') {
        wasBackgrounded.current = true;
      } else if (s === 'active' && wasBackgrounded.current) {
        wasBackgrounded.current = false;
        player
          .replaceAsync(uri)
          .then(() => {
            player.muted = true;
            player.loop = true;
            player.audioMixingMode = 'mixWithOthers';
            player.play();
          })
          .catch(() => {});
      }
    });
    return () => sub.remove();
  }, [player, uri]);

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
  loading: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    marginTop: 14,
    fontFamily: DisplayFont,
    color: Paper,
    fontSize: 12,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
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
