import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { AppState } from 'react-native';

import type { ImageLoadEventData, ImageProgressEventData } from 'expo-image';

import { isOnline } from '@/lib/connectivity';
import { isDiskSpaceCritical } from '@/lib/disk-space';
import { isPlaceholderLoad, loadProgressFraction } from '@/lib/image-load-event';
import { ICLOUD_ACCESS_HINT_MS, ICLOUD_LOAD_DEADLINE_MS } from '@/lib/loading-timeouts';

// Shared "is this iCloud-backed image taking too long?" state machine, lifted out
// of the feed card (feed-card.tsx) so the Near Me grid and viewer get the same
// recovery instead of sitting BLACK FOREVER on a stalled PHImageManager fetch — the
// crash report symptom on an iCloud-"Optimize Storage" library, where an offloaded
// original can hang with no load and no error. Dropping the <Image> on `unreachable`
// also releases the held native fetch, which relieves the memory pressure behind the
// jetsam.
//
// Loads are TWO-TIER under the patched opportunistic delivery (see
// patches/expo-image+56.0.9.patch): a degraded blurred placeholder arrives first
// (onLoad with isPlaceholder=true → `preview`), then the full image (→ `loaded`).
// Only the FINAL image disarms the hint/deadline timers — the blur must never
// count as done, or a stalled iCloud download leaves the user on a blur forever
// with no recovery. `accessing`/`unreachable` can therefore coexist with
// `preview`: callers keep the blurred image mounted (the native request is still
// live and a late completion dissolves in) and overlay a hint/Retry pill instead
// of dropping to the empty error frame.
//
// Every field is keyed by asset id so a recycled view (the grid reuses cells without
// remounting, deliberately — see grid.tsx) re-derives a fresh state for its new
// asset purely from `deriveFlags`, with no setState-in-effect reset.

export type LoadState = {
  // The asset whose <Image> has reported a FINAL image. `imageReady` is
  // `loadedId === assetId`, so swapping the asset on a recycled view auto-clears
  // readiness without a reset.
  loadedId: string | null;
  // The asset whose <Image> has painted the degraded blurred placeholder — the
  // frame is showing SOMETHING, just not the full-quality image yet.
  previewId: string | null;
  // Past the hint mark while online: surface "Accessing from iCloud…".
  accessingId: string | null;
  // Offline at the hint, past the hard deadline, or a hard load error: offer
  // Retry. Callers drop the image only when there's no preview showing.
  unreachableId: string | null;
  // Bumping this re-arms the timers (and lets a caller remount the <Image>) for a
  // fresh attempt after Retry.
  reloadNonce: number;
};

export const initialLoadState: LoadState = {
  loadedId: null,
  previewId: null,
  accessingId: null,
  unreachableId: null,
  reloadNonce: 0,
};

export type LoadAction =
  | { type: 'loaded'; id: string }
  | { type: 'preview'; id: string }
  | { type: 'accessing'; id: string }
  | { type: 'unreachable'; id: string }
  | { type: 'retry'; id: string };

// Pure transition (unit tested). Each flag is tied to the asset id that produced it,
// so a later asset on the same (recycled) view ignores a previous asset's flags. A
// result that wouldn't change anything returns the same object so React can bail out.
export function loadReducer(state: LoadState, action: LoadAction): LoadState {
  switch (action.type) {
    case 'loaded':
      return state.loadedId === action.id ? state : { ...state, loadedId: action.id };
    case 'preview':
      // A late degraded event after the final image adds nothing.
      if (state.loadedId === action.id) return state;
      return state.previewId === action.id ? state : { ...state, previewId: action.id };
    case 'accessing':
      // Only meaningful while the FINAL image hasn't resolved; a preview alone
      // doesn't suppress it (the hint reads over the blur).
      if (state.loadedId === action.id) return state;
      return state.accessingId === action.id ? state : { ...state, accessingId: action.id };
    case 'unreachable':
      if (state.loadedId === action.id) return state;
      return state.unreachableId === action.id ? state : { ...state, unreachableId: action.id };
    case 'retry':
      // Clear only this asset's flags and re-arm; a fresh attempt starts loading.
      // previewId clears too — the caller remounts the <Image> (nonce key), so the
      // view is momentarily blank and the state must match it.
      return {
        loadedId: state.loadedId === action.id ? null : state.loadedId,
        previewId: state.previewId === action.id ? null : state.previewId,
        accessingId: state.accessingId === action.id ? null : state.accessingId,
        unreachableId: state.unreachableId === action.id ? null : state.unreachableId,
        reloadNonce: state.reloadNonce + 1,
      };
    default:
      return state;
  }
}

export type LoadFlags = {
  // The full-quality image rendered.
  imageReady: boolean;
  // The degraded blurred placeholder rendered (and the final hasn't yet).
  preview: boolean;
  // Anything is visible in the frame (preview or final).
  showing: boolean;
  // These two can coexist with `preview` — render them as a pill over the blur
  // rather than the empty-frame spinner/error when `preview` is true.
  accessing: boolean;
  unreachable: boolean;
};

// Pure derive (unit tested). Flags are false for any asset other than the queried one
// — the recycle-safety guarantee. `accessing`/`unreachable` never show once loaded.
export function deriveFlags(state: LoadState, assetId: string): LoadFlags {
  const imageReady = state.loadedId === assetId;
  const preview = state.previewId === assetId && !imageReady;
  return {
    imageReady,
    preview,
    showing: imageReady || preview,
    accessing: state.accessingId === assetId && !imageReady,
    unreachable: state.unreachableId === assetId && !imageReady,
  };
}

export type IcloudImageLoad = LoadFlags & {
  reloadNonce: number;
  // Whole percent (0–100) of an in-flight fetch for THIS asset, or null when
  // unknown / already final. Callers append it to "Accessing from iCloud…" so a
  // long download reads as movement, not a freeze.
  progressPct: number | null;
  // True when the device's free disk space was critically low at the moment the
  // load became unreachable — the honest explanation on a stuffed phone, where
  // iCloud downloads have nowhere to land. Callers swap the generic "Photo
  // couldn't load" for a storage message when this is set.
  storageFull: boolean;
  onLoad: (e: ImageLoadEventData) => void;
  onError: () => void;
  onProgress: (e: ImageProgressEventData) => void;
  retry: () => void;
};

export function useIcloudImageLoad(
  assetId: string,
  {
    // Gate for the hint/deadline timers (the load callbacks always work). Feed
    // cards and viewer pages pass `isCurrent && isActive` so the 12s deadline
    // measures time the USER has been waiting on the photo, not time an
    // off-screen ±2 neighbor has been mounted at low priority.
    enabled = true,
  }: { enabled?: boolean } = {}
): IcloudImageLoad {
  const [state, dispatch] = useReducer(loadReducer, initialLoadState);
  const flags = deriveFlags(state, assetId);
  const { imageReady } = flags;

  // Download progress, keyed by asset id like every other field. The ref is the
  // stall-detector's source of truth (updated on every native tick); the state
  // mirrors it as a whole percent so the UI re-renders only when the displayed
  // number would change.
  const progressRef = useRef<{ id: string; fraction: number } | null>(null);
  const [progress, setProgress] = useState<{ id: string; pct: number } | null>(null);
  const progressPct =
    progress && progress.id === assetId && !imageReady ? progress.pct : null;

  // Snapshot of the disk state taken at each unreachable transition (all of
  // which happen in timer/event contexts, so this is never a setState during an
  // effect body). Global, not per-asset — displayed only alongside
  // `unreachable`, and re-evaluated at every new failure.
  const [storageFull, setStorageFull] = useState(false);
  const markUnreachable = useCallback((id: string) => {
    setStorageFull(isDiskSpaceCritical());
    dispatch({ type: 'unreachable', id });
  }, []);

  // Restart pending timers after a true background→foreground: iOS suspends the
  // JS clock with the app, so a deadline armed before backgrounding would fire
  // the moment the app returns — a spurious "couldn't load" for a download that
  // never got wall-clock time. Benign inactive→active blips (Control Center, a
  // notification shade) don't count, same pattern as FeedVideo. Already-set
  // flags persist deliberately; only the not-yet-fired timers re-arm.
  const [fgEpoch, bumpFgEpoch] = useReducer((n: number) => n + 1, 0);
  const wasBackgrounded = useRef(false);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'background') {
        wasBackgrounded.current = true;
      } else if (s === 'active' && wasBackgrounded.current) {
        wasBackgrounded.current = false;
        bumpFgEpoch();
      }
    });
    return () => sub.remove();
  }, []);

  // Past the hint mark and the FINAL image still hasn't landed: fail straight to
  // unreachable if the phone is offline (no point waiting out the deadline),
  // otherwise surface "Accessing from iCloud…" so the wait reads as working.
  // Re-armed by reloadNonce on retry and by fgEpoch on foreground.
  useEffect(() => {
    if (!enabled || imageReady) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      const online = await isOnline();
      if (cancelled) return;
      if (online) dispatch({ type: 'accessing', id: assetId });
      else markUnreachable(assetId);
    }, ICLOUD_ACCESS_HINT_MS);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [enabled, imageReady, assetId, state.reloadNonce, fgEpoch, markUnreachable]);

  // STALL ceiling (not a total-time ceiling): the deadline fires only after a
  // full window with zero download progress. A slow-but-moving fetch (offloaded
  // original on a bad network, or a storage-pressured phone where every photo is
  // a download) re-arms the window on each firing that saw progress — declaring
  // those dead flooded the whole feed with false "Photo couldn't load" states.
  // A genuinely silent fetch (no ticks at all) still becomes unreachable after
  // one window, so a tile/page can never sit black (or blurred with no recourse)
  // forever. With no preview the caller drops the image to release the held
  // fetch; with one it keeps the blur mounted and offers Retry.
  useEffect(() => {
    if (!enabled || imageReady) return;
    let t: ReturnType<typeof setTimeout>;
    const arm = () => {
      const seen = progressRef.current;
      const fractionAtArm = seen && seen.id === assetId ? seen.fraction : -1;
      t = setTimeout(() => {
        const now = progressRef.current;
        const fraction = now && now.id === assetId ? now.fraction : -1;
        if (fraction > fractionAtArm) {
          arm();
          return;
        }
        markUnreachable(assetId);
      }, ICLOUD_LOAD_DEADLINE_MS);
    };
    arm();
    return () => clearTimeout(t);
  }, [enabled, imageReady, assetId, state.reloadNonce, fgEpoch, markUnreachable]);

  const onLoad = useCallback(
    (e: ImageLoadEventData) =>
      dispatch(
        isPlaceholderLoad(e) ? { type: 'preview', id: assetId } : { type: 'loaded', id: assetId }
      ),
    [assetId]
  );
  // A hard error is a real result (the patched loader only emits it for a failed
  // FINAL delivery, never a cancellation): go straight to the recovery UI instead
  // of waiting out the deadline on a frame that will never fill.
  const onError = useCallback(() => markUnreachable(assetId), [assetId, markUnreachable]);
  const onProgress = useCallback(
    (e: ImageProgressEventData) => {
      const fraction = loadProgressFraction(e);
      if (fraction == null) return;
      progressRef.current = { id: assetId, fraction };
      const pct = Math.floor(fraction * 100);
      setProgress((prev) => (prev?.id === assetId && prev.pct === pct ? prev : { id: assetId, pct }));
    },
    [assetId]
  );
  const retry = useCallback(() => {
    // Wipe progress so the fresh attempt's stall window starts from scratch and
    // the UI doesn't show the dead request's stale percentage.
    progressRef.current = null;
    setProgress((prev) => (prev?.id === assetId ? null : prev));
    dispatch({ type: 'retry', id: assetId });
  }, [assetId]);

  return {
    ...flags,
    reloadNonce: state.reloadNonce,
    progressPct,
    storageFull,
    onLoad,
    onError,
    onProgress,
    retry,
  };
}
