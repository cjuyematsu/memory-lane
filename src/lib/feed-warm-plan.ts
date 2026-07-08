// Pure planning for the feed's hidden warm layer (feed.tsx): which queued
// shuffle destinations get an off-screen decode mounted right now.
//
// Mounting a warm view for an iCloud-offloaded photo starts its download, so
// mounting every queued cloud entry at once would race N downloads against each
// other (and against the photo the user is looking at). Instead the queue may
// hold any mix of entries, and downloads are serialized HERE: every renderable
// entry mounts (on-device, or a cloud photo whose final bytes already landed —
// keeping its cache entry warm), plus only the FIRST not-yet-downloaded cloud
// entry. When that one finishes (or is dropped), the next pending cloud entry
// mounts. This replaces the old admission-time "one pending cloud in the queue"
// gate, which starved the queue on heavily offloaded libraries.

export type WarmEntry = {
  id: string;
  // Residency captured at admission time from the refill probe (a timed-out
  // probe records its pessimistic `true` guess) — never read from module
  // caches at render time.
  inCloud: boolean;
};

// Ids to mount in the warm layer, in queue order. `allowPendingDownload=false`
// mounts renderables only — the feed passes it while paused after a FAILED warm
// download (offline / storage-full / iCloud error): without the pause, fast
// failures loop mount→error→drop→refill against the Photos framework all
// session, since dropping an entry triggers an immediate refill.
export function planWarmMounts(
  entries: readonly WarmEntry[],
  loaded: ReadonlySet<string>,
  allowPendingDownload = true
): string[] {
  const ids: string[] = [];
  let pendingCloudMounted = false;
  for (const e of entries) {
    if (!e.inCloud || loaded.has(e.id)) {
      ids.push(e.id);
      continue;
    }
    if (allowPendingDownload && !pendingCloudMounted) {
      pendingCloudMounted = true;
      ids.push(e.id);
    }
  }
  return ids;
}

// The single entry currently allowed to download (the first pending cloud one),
// or null when nothing is downloading. Drives the stuck-download watchdog.
export function pendingWarmDownload(
  entries: readonly WarmEntry[],
  loaded: ReadonlySet<string>
): string | null {
  for (const e of entries) {
    if (e.inCloud && !loaded.has(e.id)) return e.id;
  }
  return null;
}
