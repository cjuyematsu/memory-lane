import { Platform } from 'react-native';

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

export function configureImageCache(): void {
  if (Platform.OS !== 'ios') return;
  Image.configureCache({ maxDiskSize: MAX_DISK_CACHE_BYTES });
}
