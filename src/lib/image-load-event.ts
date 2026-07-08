import type { ImageLoadEventData, ImageProgressEventData } from 'expo-image';

// The expo-image patch (patches/expo-image+56.0.9.patch) adds `isPlaceholder`
// to the iOS onLoad payload: `true` for the degraded opportunistic delivery
// (the fast blurred low-res placeholder PHImageManager hands back before the
// full — possibly iCloud-downloaded — image). Android/web never set the field,
// and an un-rebuilt iOS binary omits it too; absent means FINAL, so everything
// downstream degrades to the pre-patch behavior. This is the single place the
// untyped field is read.
export type DegradedAwareLoadEvent = ImageLoadEventData & { isPlaceholder?: boolean };

export function isPlaceholderLoad(e: ImageLoadEventData | null | undefined): boolean {
  return (e as DegradedAwareLoadEvent | null | undefined)?.isPlaceholder === true;
}

// Recycling guard (the Near Me grid, the one surface that reuses an <Image>
// element across item swaps — nonce-only key, by design): a late onLoad from
// the PREVIOUS source can arrive after `item` changed and would be credited to
// the new asset — disarming its recovery timers and recording a wrong aspect
// ratio. Deliberately conservative: it only flags a mismatch when BOTH sides
// are ph:// URIs (which pass through the native pipeline verbatim), so a
// missing url or a transformed non-ph:// url (Android content://, network) can
// never suppress a legitimate load.
export function isStaleLoadEvent(
  e: ImageLoadEventData | null | undefined,
  expectedUri: string
): boolean {
  const url = e?.source?.url;
  return (
    typeof url === 'string' &&
    url.startsWith('ph://') &&
    expectedUri.startsWith('ph://') &&
    url !== expectedUri
  );
}

// For ph:// loads, expo-image's iOS ImageView emits a native 0…1 `progress`
// fraction (PHImageManager's download progress) and leaves `loaded`/`total`
// null; network URLs report byte counts instead. The `progress` field isn't in
// expo-image's TS type, so this is the one place it's read.
export type ProgressAwareEvent = ImageProgressEventData & { progress?: number };

/** Fraction 0…1 of the fetch, or null when the event carries nothing usable. */
export function loadProgressFraction(
  e: ImageProgressEventData | null | undefined
): number | null {
  const p = e as ProgressAwareEvent | null | undefined;
  if (!p) return null;
  if (typeof p.progress === 'number' && Number.isFinite(p.progress)) {
    return Math.min(1, Math.max(0, p.progress));
  }
  if (
    typeof p.total === 'number' &&
    Number.isFinite(p.total) &&
    p.total > 0 &&
    typeof p.loaded === 'number' &&
    Number.isFinite(p.loaded)
  ) {
    return Math.min(1, Math.max(0, p.loaded / p.total));
  }
  return null;
}
