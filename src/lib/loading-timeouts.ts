// Centralized, tunable upper bounds for every native call / load that could
// otherwise hang indefinitely. The app must never sit on a spinner forever, so
// each await that hits the OS (Photos, Location, iCloud, network) is bounded by
// one of these via lib/async-safety. These are conservative starting points —
// tune against real-device behavior (Xcode console / Network Link Conditioner).

// ── Feed photo (the visible card) ───────────────────────────────────────────
/** Still loading after this → swap the spinner label to "Accessing from iCloud…". */
export const ICLOUD_ACCESS_HINT_MS = 2500;
/** Hard ceiling on one card's image load; past this we treat it as unreachable
 *  (drop the image to free the held fetch, show "Photo couldn't load" with
 *  Retry / Find one on device) instead of spinning. */
export const ICLOUD_LOAD_DEADLINE_MS = 12000;

// ── Hidden background downloads (never user-visible) ───────────────────────
/** Cap on the warm layer's single in-flight iCloud download; past this the
 *  entry is dropped so one stuck download can't block the rotation all session. */
export const WARM_PENDING_DOWNLOAD_MS = 20000;
/** Same cap for the old-memory trickle's hidden download slot. */
export const OLD_MEMORY_DOWNLOAD_CAP_MS = 20000;
/** After a warm download FAILS, hold off mounting the next pending cloud entry
 *  this long. Fast failures (offline, storage-full) would otherwise loop
 *  mount→error→drop→refill against the Photos framework all session. */
export const WARM_FAILURE_PAUSE_MS = 30000;

// ── Entry selection (first photo on cold launch) ────────────────────────────
/** Per-candidate iCloud probe; a slow probe is treated as offloaded and skipped. */
export const ENTRY_PROBE_MS = 2500;
/** Whole entry-selection deadline; if nothing committed, open the newest photo. */
export const ENTRY_SELECT_DEADLINE_MS = 5000;
/** "Find one on device" forward-probe budget (user is waiting on the button). */
export const FIND_ON_DEVICE_SCAN_MS = 4000;

// ── Cold-start system calls ─────────────────────────────────────────────────
export const MEDIA_PERMISSION_MS = 6000;
export const LIBRARY_QUERY_MS = 12000;
export const SCREENSHOT_FILTER_MS = 8000;
export const LOCATION_PERM_MS = 6000;
export const LOCATION_FIX_MS = 8000;
export const LOCATE_READ_MS = 6000;
export const ONBOARDING_PROBE_MS = 4000;
export const CONNECTIVITY_CHECK_MS = 2000;
/** Upper bound on waiting for the display font (`useFonts`) before proceeding
 *  with the system fallback. Without this the boot Polaroid strands forever if
 *  `useFonts` never settles — as it does on Android release builds. */
export const FONT_LOAD_MS = 3000;

// ── Silent auto-retry policy for cold-start calls (then the error/Retry UI) ──
export const COLD_START_RETRIES = 3;
export const COLD_START_RETRY_BASE_MS = 600;
