import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { useAssetFeed } from '@/hooks/use-asset-feed';
import { useCurrentLocation } from '@/hooks/use-current-location';
import { useMediaPermission } from '@/hooks/use-media-permission';
import { useNearbyAssets } from '@/hooks/use-nearby-assets';
import { isBannerActive, showBanner } from '@/lib/foreground-banner';
import { shouldGreet } from '@/lib/nearby-greeting';
import * as greetingCooldown from '@/lib/nearby-greeting-cooldown';
import { getPendingCluster } from '@/lib/pending-cluster';

// How long after an open we wait before reading the nearby count, so a fresh GPS
// fix + the 300ms feed debounce + an index sync can settle (mirrors Near Me's
// SETTLE_MS). The trigger re-arms on each change, so this is really "quiet for
// this long after things stop moving".
const GREET_DELAY_MS = 1200;

async function maybeGreet(lat: number, lng: number, count: number): Promise<void> {
  // Cheap synchronous gates first, so we skip the disk read when obviously off.
  if (count <= 0 || isBannerActive() || getPendingCluster() != null) return;
  const inCooldown = await greetingCooldown.isInCooldown(lat, lng);
  // Re-check the live flags after the await — a geofence banner or a
  // notification tap may have arrived during the cooldown read.
  if (
    !shouldGreet({
      count,
      inCooldown,
      bannerActive: isBannerActive(),
      hasPendingCluster: getPendingCluster() != null,
    })
  ) {
    return;
  }
  await greetingCooldown.markNotified(lat, lng);
  showBanner({ kind: 'nearby', count });
}

/**
 * Renderless. Every time the app opens (cold launch or foreground resume), and
 * once the nearby count has settled, shows a "N memories near you" banner if
 * there are nearby memories and this place isn't in its 24h cooldown.
 *
 * Independent of the Memory-notifications toggle: it's an in-app banner that
 * needs only photo + location access, so it works even for users who never
 * enabled OS notifications. Derives from the same shared located index Near Me
 * uses (these hooks are module-cached/single-flight, so this extra consumer is
 * cheap) — and feeds it LIVE assets/origin, never frozen inputs.
 */
export function NearbyMemoriesGreeter() {
  const [mediaPermission] = useMediaPermission();
  const granted = !!mediaPermission?.granted;
  const { state: feedState } = useAssetFeed(granted);
  const { state: locationState } = useCurrentLocation();

  const assets = feedState.status === 'ready' ? feedState.assets : null;
  const origin = locationState.status === 'ready' ? locationState.coords : null;
  const nearby = useNearbyAssets(assets, origin);

  // An "open" event: 0 is the cold-start open (AppState is already 'active' on
  // launch, so no 'change' fires); each resume bumps it.
  const [openToken, setOpenToken] = useState(0);
  // The last open we've already evaluated, so we greet at most once per open
  // even as nearby/origin keep settling afterwards.
  const greetedToken = useRef(-1);
  const evalTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') setOpenToken((t) => t + 1);
    });
    return () => sub.remove();
  }, []);

  // When an unevaluated open has a ready nearby count + location, (re)arm a
  // single debounced evaluation. Re-running clears the prior timer, so rapid
  // stale→fresh settles coalesce into one fire after things go quiet.
  const lat = origin?.latitude;
  const lng = origin?.longitude;
  useEffect(() => {
    if (greetedToken.current === openToken) return;
    if (nearby.status !== 'ready' || lat == null || lng == null) return;
    const count = nearby.photos.length + nearby.videos.length;
    const token = openToken;
    if (evalTimer.current) clearTimeout(evalTimer.current);
    evalTimer.current = setTimeout(() => {
      greetedToken.current = token; // fire once per open
      void maybeGreet(lat, lng, count);
    }, GREET_DELAY_MS);
    return () => {
      if (evalTimer.current) clearTimeout(evalTimer.current);
    };
  }, [openToken, nearby.status, nearby.photos, nearby.videos, lat, lng]);

  return null;
}
