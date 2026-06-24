# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Expo SDK 56 — read the versioned docs first

Expo and React Native APIs in this project are **SDK 56 / RN 0.85 / React 19**, which differ substantially from older releases you may recall. Before writing code against any `expo-*` package, `react-native`, `expo-router`, or `react-native-reanimated`, consult the exact versioned docs at https://docs.expo.dev/versions/v56.0.0/. Do not rely on memory of older Expo APIs (e.g. `expo-file-system` here uses the `File`/`Paths` object API, not the legacy `FileSystem.*` functions).

## Commands

```bash
npx expo start                                           # primary dev workflow: Metro dev server against the installed dev build
npx expo run:ios --configuration Release --device        # build & install the native app on a connected iOS device
npx expo run:android --variant release --device          # build & install the native app on a connected Android device (Android uses --variant, NOT --configuration)
npm run web                                              # expo start --web
npm run lint                                             # expo lint (ESLint flat config)
npm test                                                 # jest (jest-expo preset)
npx jest src/lib/__tests__/geofence-manager.test.ts      # run a single test file
npx jest -t "cooldown"                                   # run tests matching a name
```

Day-to-day development is `npx expo start` against an already-installed dev build. This app uses a custom native build (a patched `expo-media-library`, background location, notifications), so it **cannot run in Expo Go**. The native app is built **in Release configuration on a physical device** (iOS: `--configuration Release --device`; Android: `--variant release --device`): the core background-location / geofencing and notification paths need a real device and only behave like production under a Release build — not the simulator or a debug build. Rebuild after changing `app.json` plugins/permissions or the patch.

`postinstall` runs `patch-package`. The patch in `patches/expo-media-library+56.0.6.patch` does two things: (1) adds Android video GPS extraction (`MediaMetadataRetriever`, in both `AssetLegacy/ModernDelegate.kt`) so videos can be located, and (2) sets `isNetworkAccessAllowed = true` in iOS `UriExtractor.swift` so `getUri()` can resolve iCloud-offloaded originals (without it, raw share fails for any "Optimize iPhone Storage" photo/video). Don't `npm install` a version that drops these without re-checking the patch applies. When regenerating with `npx patch-package expo-media-library`, **always pass `--include 'AssetLegacyDelegate\.kt$|AssetModernDelegate\.kt$|UriExtractor\.swift$'`** — a bare run sweeps in 1MB of leaked `android/.gradle` build junk.

## What this app is

"Mems" surfaces old photo memories tied to **place**. Its core feature: while you move around, it geofences clusters of locations where you took photos long ago and notifies you when you return to one — then shows those photos. Two tabs:
- **Camera Roll** — a shuffle feed of single framed photos (`components/feed/`).
- **Near Me** — a grid of photos/videos taken within a radius of your current location (`components/near-me/`).

## Architecture

### The shared located-assets index is the spine
`hooks/use-located-assets.ts` is the single source of truth that everything else derives from. It performs the one expensive operation in the app — a native metadata read (GPS + creation time + media type) per asset — and builds an `AssetIndex` that is:
- **persisted to disk** (`located-assets.json` in the document directory) and reused across launches,
- **updated incrementally**: on library change only newly-added assets are located and deleted ones dropped (`sync()`), never a full re-scan,
- **cached in a module variable** keyed by the asset-array reference, with in-flight dedup.

Two consumers derive cheap in-memory results from it:
- `hooks/use-photo-clusters.ts` — quantizes located assets into ~50m grid cells (`PhotoCluster`). Cluster cache is keyed on the `AssetIndex` object reference, so it auto-recomputes whenever the index rebuilds.
- `hooks/use-nearby-assets.ts` — radius query for the Near Me grid (wider net: 500m photos / 1km videos vs. the ~50m cluster cells).

When touching anything location/photo-related, work through this index rather than re-reading metadata.

### Background geofencing & notifications (the hard part)
`lib/geofence-manager.ts` defines the `TaskManager` task and all geofence lifecycle logic. Critical constraints:
- It is **imported first in `app/_layout.tsx`**, before anything else, so `TaskManager.defineTask` registers before the OS can cold-launch the headless task (otherwise RN throws "No task registered").
- The task may run **headless with the app killed**, so its handlers read everything from disk (`loadSettingsFromDisk`, `loadClustersFromDisk`) and never touch React or in-memory module state that wouldn't exist in a cold background process.
- Platforms cap region monitoring at ~20 regions. When there are more notifiable clusters than slots, the last slot becomes a **re-anchor boundary**: an exit-only region whose exit wakes the task to re-pick regions around the user's new position — background rotation without continuous tracking.
- **Foreground fallback**: with only When-In-Use location (no "Always"), `startGeofencingAsync` throws. The manager then runs a foreground `watchPositionAsync` that pushes hits through the same enter pipeline. The "Always" upgrade is only requested when the user enables Memory notifications, not at onboarding.

`components/notifications/notification-orchestrator.tsx` is a renderless component that drives this from React: gated entirely on the `enabled` flag, evaluates geofences on app foreground, and routes notification taps to the Near Me cluster view.

The notification gating pipeline (in `handleClusterEnter`): `enabled` → `isAreaNotifiable` (cluster's newest photo older than ~90 days **and** no recent media anywhere in a 150m neighborhood, so home/work never fire) → cooldown (`lib/notification-cooldown.ts`, 6h within 150m) → engagement suppression (`lib/notification-engagement.ts`, ignored 3× → suppressed 30 days). Foreground notifications are suppressed at the system level (`setNotificationHandler` returns all-false) and shown as an in-app banner (`lib/foreground-banner.ts` → `components/notifications/memory-banner.tsx`) instead. The location cooldown is a `createLocationCooldown({file,windowMs,radiusM})` factory (`lib/location-cooldown.ts`); the geofence one is the 6h instance.

Separately, `components/notifications/nearby-memories-greeter.tsx` (root-mounted, renderless) shows a **"N memories near you" banner on every app open** (cold launch + each foreground), independent of the notifications toggle — it only needs photo+location. It reuses the same `BannerData` slot (a discriminated union: `'cluster'` vs `'nearby'`, so the two banners never stack), counts all Near Me items (150m), has its own 24h `nearby-greeting-cooldown` (same factory), and taps to the Near Me grid via `lib/near-me-request.ts` (`requestNearMe` switches the tab **without** opening a ClusterView, unlike `setPendingCluster`). Pure decision in `lib/nearby-greeting.ts` (`shouldGreet`).

### Cross-tree state: hand-rolled pub/sub, not a state library
There is no Redux/Zustand/Context for shared state. The recurring pattern is a **module-level variable + `Set` of subscribers + a `useXxx` hook** that subscribes. See `lib/pending-cluster.ts` (bridges out-of-React notification listeners to the UI), `hooks/use-notification-settings.ts`, and `hooks/use-asset-feed.ts`. When adding shared state, follow this pattern: a `loadFromDisk`/`save` pair, a module cache, an in-flight promise to dedupe, and a subscriber set.

### Persistence
`lib/persisted-file.ts` wraps the SDK 56 `File`/`Paths` API. All durable state (the index, notification settings, cooldown, engagement) lives in the **document directory** (`Paths.document`) — not cache, which the OS purges under storage pressure — and `readPersisted` does a one-time migration from the legacy cache location.

### Navigation
Uses `expo-router` but with a **single route** under `src/app/`: `_layout.tsx` (root providers + global overlays) and `index.tsx`, which just renders `components/top-tabs.tsx`. `TopTabs` is a custom **gesture-driven two-pane pager** (Reanimated + RNGH), not expo-router navigation — it manages the Camera Roll / Near Me swipe, the memory-feed overlay that slides over, and gates tab-swiping so you can't escape an open memory/photo view. Notification taps flow through `pending-cluster` → TopTabs switches to Near Me → `ClusterView` overlay.

### Sharing a surfaced photo (`components/share/`)
Share buttons in the feed (bottom-left, mirroring shuffle) and the Near Me viewer top bar call `requestShare(asset, isVideo)` (`lib/share-memory.ts`, the same module-pub/sub pattern as `pending-cluster`). The root-mounted `ShareHost` shows a gallery-themed chooser, then runs one of two flows. **Raw** (`prepareRawShare` → `asset.getUri()` gives the original `file://`; offloaded iCloud originals are **downloaded** thanks to the `UriExtractor.swift` patch above — the prepare step is wrapped in `withTimeout(…, RAW_SHARE_TIMEOUT_MS)` so a slow/offline download can't hang the spinner, surfacing a friendly iCloud error) → `Sharing.shareAsync`. For **iOS photos** the original is first **copied (same bytes/format) into `Paths.cache`** and that copy is shared: iOS builds the share-sheet thumbnail out-of-process and can't read the Photos-managed `fullSizeImageURL`, so sharing it directly shows a blank preview — a file in our sandbox previews correctly. Videos preview fine from the original URL and are shared as-is (no large copy). Note `expo-sharing` **ignores the `mimeType`/`UTI` options on iOS** — the preview comes purely from the file. **Framed** (photos only) mounts an **off-screen** `ShareCard` (white canvas + Letterbox frame + date/place caption, same look as the feed), waits for its `onReady` (image decoded + caption settled), then `captureRef` (react-native-view-shot) → `shareAsync`. Off-screen = `left:-10000` and **opaque** — `opacity:0`/`display:none` makes view-shot capture blank. If a framed capture ever blanks on the New Arch, try captureRef's iOS `useRenderInContext: true`. `asset.getInfo()` (this is the SDK 56 **MediaLibraryNext** `Asset` API) has **no `localUri`** — use `getUri()` for a file path. Both deps are native → a rebuild is needed.

### Near Me is a frozen snapshot, not a live list
The grid renders a **snapshot** (`displayItems` in `near-me.tsx`), not live `items`. It updates only on (1) first load, (2) app foreground (`AppState` 'active'), and (3) explicit user refresh (pull-to-refresh + a refresh pill next to the bell + the empty-state button, all routed through `onUserRefresh`). Passive library changes (a photo taken/deleted while the app is open) do **not** alter the grid — by design, so nothing pops in/out under the user. Mechanism: an `accepting` window (opened by `arm()`, closed by a token-guarded `SETTLE_MS` timer) during which a **guarded set-state-during-render** (`if (status==='ready' && displayItems!==items && (accepting || displayItems===null)) setDisplayItems(items)`) adopts each settled recompute; outside the window it's inert. Do **not** convert this to a `setState`-in-`useEffect` (trips `react-hooks/set-state-in-effect`, React 19). **Critical:** `useNearbyAssets` is still fed **live** `assets`/`origin` — never freeze its inputs, because it drives the shared global located index (`ensureIndex`) that the geofence notifications read; freezing inputs would drop new photos from the on-disk index. The notification orchestrator (root-mounted, own `useAssetFeed`) is unaffected and keeps the index/clusters current independently. `useCurrentLocation` is one-shot (updates on foreground/`refresh`), so walking never churns the grid anyway.

The identity-stability layers below still matter (they keep the live `useNearbyAssets`→`items` pipeline cheap and stable, which the snapshot copies from):
The dominant Near Me flicker was **data churn, not the list widget**: `addListener` MediaLibrary events fire constantly (iCloud sync, edits), each making `use-asset-feed` republish a new `Asset[]`, which makes `computeNearby` mint all-new `NearbyAsset` objects, so the grid received new data and **repainted every tile**. Swapping FlatList→FlashList didn't help because the churn is upstream. Fixed by **identity stability at three layers**, all keyed on the data, not the widget — keep these when touching Near Me:
- `use-asset-feed.ts` `sameAssetIds` — skip `publishAssets` when the reloaded library has the same ordered ids (don't hand out a new `Asset[]` for a no-op event).
- `use-nearby-assets.ts` `stableNearby`/`sameNearby` — reuse `NearbyAsset` objects by id so unchanged tiles keep their reference across recomputes.
- `near-me.tsx` — `items` is a signature-memo (stable array ref while the ordered nearby-id list is unchanged), `onPressItem` is `useCallback`, and `Grid` is `memo` — so a NearMe re-render can't repaint the grid.

The grid (`grid.tsx`) is **FlashList v2** (`@shopify/flash-list`, JS-only, no native rebuild; needs the New Architecture, which SDK 56 has) for smooth scroll recycling, with `maintainVisibleContentPosition` **disabled** (it's on by default in v2) so a newly-taken photo lands at the top of the viewport rather than anchored above it.

On `expo-image`'s **`recyclingKey`**: changing it resets the image to blank/placeholder before loading. The grid tiles **deliberately do NOT set it** and cross-dissolve (`transition={180}`) instead — because the list is newest-first, a single add/delete shifts every item by a slot, the recycler hands each visible cell a new `item`, and with `recyclingKey` set the whole grid would blank to gray at once ("everything flashes white"). Without it, a reassigned cell keeps its frame and dissolves to the new source, so only the changed tile fades. Tradeoff (accepted): a fast scroll can briefly show a tile's previous thumbnail before the dissolve — don't re-add `recyclingKey` to "fix" it. The viewer pager and filmstrip (`viewer.tsx`) are `FlatList`/`ScrollView` (mount/unmount, not recycling), so they leave `recyclingKey` off too — there it would only add a reset-to-blank flash.

### Metadata platform quirks (where bugs hide)
`hooks/use-asset-metadata.ts` is layered caches (full / location / time / iCloud) with in-flight dedup. Watch for:
- Android MediaStore returns `creationTime` `0` for photos with no DATE_TAKEN — use `firstValidTime` (rejects `0`/null), never `??`, then fall back to modification time. This caused blank dates.
- iOS photos may be iCloud-resident (`getIsInCloud`); rendering them needs a network download. Pass `asset.id` (a `ph://` URI) to `expo-image`/`expo-video`, never a resolved file path, or iCloud downloads fail silently.
- Screenshots are rejected differently per platform (subtype check on iOS, "Screenshots" album on Android) in `use-asset-feed.ts`.
- **Never cache a *failed* native read** (don't `.catch(() => null)` then `cappedSet`). A thrown read must propagate uncached so it can be retried; only cache a *successful* read (including a legit `null`, e.g. a no-GPS photo). `hydrateAsset` resolves each read into an `{ok}` result and caches only when all succeeded; `useAssetMetadata` retries the best-effort meta on a short backoff (~4s) for the genuine cold-launch case where the first read throws before the Photos framework is warm. It surfaces only a *complete* meta (`fullCache.has`), so the caption never fades in with a blank date.
- **The intermittent "blank caption on the first photo" was a React-Compiler reactivity bug, not a read failure.** `useAssetMetadata` reads `fullCache.get(asset.id)` *non-reactively* in render. When the feed's `warmAssetMetadata` populated `fullCache` *between* the card's first render (cache empty → returned null) and the card's effect running, the effect's old `if (fullCache.has(id)) return` early-returned without `setFetched`, nothing re-rendered, and the compiler kept serving the memoized stale `null` forever. Fix: the effect **always** runs `tryHydrate` (never short-circuits on a cache hit), so `setFetched` always fires and syncs `fetched` → memo invalidates → caption appears. **Don't read a module-level mutable cache directly in render and assume a later external write will show up** — drive the surfaced value through state.

## Conventions

- **Path aliases**: `@/*` → `src/*`, `@/assets/*` → `assets/*` (tsconfig + jest `moduleNameMapper`).
- **Tests** live in `__tests__/` dirs next to the code and cover **pure logic only** (clustering, cooldown, engagement, geofence selection math, time formatting). Heavy native/UI paths aren't unit-tested. Keep new logic extractable into pure functions for the same reason.
- **React Compiler is enabled** (`app.json` → `experiments.reactCompiler`). The `react-hooks/immutability` ESLint rule is deliberately **off** (see `eslint.config.js`) because every hit is a legitimate Reanimated `sharedValue.value` write — don't re-enable it.
- **SVGs import as components** via `react-native-svg-transformer` (`import Icon from '@/assets/icons/x.svg'`); see `metro.config.js` and `svg.d.ts`.
- **Web variants**: files like `use-color-scheme.web.ts` / `animated-icon.web.tsx` provide platform-specific implementations resolved by Metro.
- **Design system** is centralized in `constants/theme.ts`: light "gallery" look — `Paper` (white canvas), `Ink` (near-black text/borders), `DisplayFont` = `ArchivoExpanded-Black` (loaded at runtime in `_layout.tsx`; the `.ttf` must exist at `assets/fonts/`). Photos are framed to a fixed `PhotoRatio`.
- **Commit messages**: short, lowercase, imperative, no conventional-commit prefix (e.g. "fix geofence re-enable and duplicate fires").

## Maintaining this file

- At the end of a session, fold in anything learned that prevents a repeat mistake; prune detail that's no longer essential as you go.
- Keep this file in the **~150–200 line range, 200 max**. When a topic outgrows a few lines, move it to a dedicated doc (e.g. `docs/<topic>.md`) and leave a one-line pointer here so all context stays reachable without bloat.
- Durable working preferences and past-mistake notes also live in auto-memory (the `MEMORY.md` index); this file is for what any contributor/agent needs to be productive.
