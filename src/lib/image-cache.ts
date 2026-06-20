import { AppState, Platform } from 'react-native';

import { Image } from 'expo-image';

// expo-image's disk cache defaults to no size limit (maxDiskSize: 0). Because
// the feed and shuffle decode photos drawn randomly from the whole library
// (up to 10k assets), `memory-disk` caching writes a copy of nearly every
// photo viewed to disk, so the cache grows unbounded — easily multiple GB over
// time. Capping maxDiskSize makes SDWebImage LRU-evict the least-recently-used
// images past the limit: the working set (current + nearby + recently shuffled
// photos) stays cached so scroll/shuffle remain instant, and only long-
// untouched photos get dropped (cheap to re-decode from the Photos library on
// revisit). configureCache is iOS-only; on Android Glide already bounds its
// own disk cache, so this is a no-op there.
const MAX_DISK_CACHE_BYTES = 256 * 1024 * 1024; // 256 MB

// The in-MEMORY cache is the real RAM risk and defaults to maxMemoryCost: 0
// (unlimited). Every full-screen photo swiped to is decoded to a ~5–8 MB RGBA
// bitmap and pinned in memory until an iOS memory warning, so sustained swiping
// climbs past 700 MB and risks a background jetsam on 3 GB devices. Capping the
// cost (in bytes) makes SDWebImage LRU-evict the oldest decoded images: the
// on-screen working set stays resident (smooth swipe), and a revisited photo
// re-decodes from the disk cache (fast, no network). Tune by watching the Xcode
// memory gauge plateau.
const MAX_MEMORY_CACHE_BYTES = 150 * 1024 * 1024; // 150 MB

export function configureImageCache(): void {
  if (Platform.OS !== 'ios') return;
  Image.configureCache({
    maxDiskSize: MAX_DISK_CACHE_BYTES,
    maxMemoryCost: MAX_MEMORY_CACHE_BYTES,
  });
}

// Free the decoded-bitmap memory cache whenever the app leaves the foreground.
// Backgrounding is exactly when iOS reclaims memory from (or jettisons) high-
// footprint apps, and the disk cache repaints visible photos instantly on
// return — so this trades a tiny re-decode on resume for a much smaller
// background footprint. Cross-platform (helps Glide on Android too). Returns the
// subscription so the caller can remove it on unmount.
export function installMemoryCacheReaper() {
  return AppState.addEventListener('change', (state) => {
    if (state === 'background') {
      Image.clearMemoryCache().catch(() => {});
    }
  });
}
