import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import * as Sharing from 'expo-sharing';
import { File, Paths } from 'expo-file-system';
import { type Asset } from 'expo-media-library';

// Bridges the share buttons (feed card + Near Me viewer) to the global
// ShareHost overlay, following the module-pub/sub convention used by
// `pending-cluster.ts` / `foreground-banner.ts`. The host renders a chooser
// for the requested asset and runs the raw / framed share flow.

export type ShareMode = 'raw' | 'framed';

export type ShareOption = {
  mode: ShareMode;
  label: string;
};

// The asset to share plus what the caller already knows about it (its media
// type — known synchronously at every call site, so the host needn't re-read
// it just to pick chooser options). null = nothing pending (host renders null).
export type ShareTarget = {
  asset: Asset;
  isVideo: boolean;
};

let target: ShareTarget | null = null;
const subscribers = new Set<() => void>();

function notify() {
  for (const fn of subscribers) fn();
}

export function requestShare(asset: Asset, isVideo: boolean): void {
  target = { asset, isVideo };
  notify();
}

export function closeShare(): void {
  if (!target) return;
  target = null;
  notify();
}

export function useShareTarget(): ShareTarget | null {
  const [t, setT] = useState<ShareTarget | null>(target);
  useEffect(() => {
    const fn = () => setT(target);
    subscribers.add(fn);
    return () => {
      subscribers.delete(fn);
    };
  }, []);
  return t;
}

// ── Pure helpers (unit-tested in share-memory.test.ts) ──────────────────────

// Videos get raw-only for v1 (no framed-with-caption still); photos get both.
export function shareOptionsFor(isVideo: boolean): ShareOption[] {
  if (isVideo) {
    return [{ mode: 'raw', label: 'Share video' }];
  }
  return [
    { mode: 'raw', label: 'Share photo' },
    { mode: 'framed', label: 'Share with caption' },
  ];
}

// The lowercased extension of a path or filename (no leading dot), or undefined
// when there isn't one. Ignores query/fragment so a `file://…/x.heic?foo` works.
function extensionOf(pathOrName: string): string | undefined {
  const base = pathOrName.split(/[?#]/)[0].split('/').pop() ?? '';
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : undefined;
}

// Extension to give the shared copy. Prefer the resolved URI's own extension
// (it reflects what `getUri()` actually produced — e.g. a rendered JPEG for an
// edited photo), fall back to the asset's filename, then a safe default.
export function shareExtension(uri: string, filename: string): string {
  return extensionOf(uri) ?? extensionOf(filename) ?? 'jpg';
}

// Best-effort MIME from a filename extension. Android's share intent wants a
// type; iOS infers from the file URL extension, so undefined there is fine.
export function mimeTypeForFilename(filename: string): string | undefined {
  const ext = filename.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'png':
      return 'image/png';
    case 'heic':
    case 'heif':
      return 'image/heic';
    case 'gif':
      return 'image/gif';
    case 'webp':
      return 'image/webp';
    case 'mov':
      return 'video/quicktime';
    case 'mp4':
    case 'm4v':
      return 'video/mp4';
    default:
      return undefined;
  }
}

// Rejected by `withTimeout` when the wrapped work doesn't settle in time, so
// callers can distinguish a slow/stuck iCloud download from a genuine failure.
export class ShareTimeoutError extends Error {
  constructor() {
    super('Share preparation timed out');
    this.name = 'ShareTimeoutError';
  }
}

// Generous: resolving a raw original may first have to download it from iCloud
// (offloaded by "Optimize iPhone Storage"), which is slower than a local read.
export const RAW_SHARE_TIMEOUT_MS = 30000;

// Reject with `ShareTimeoutError` if `p` hasn't settled within `ms`. This does
// NOT cancel the underlying work — the native iCloud download keeps running and
// iOS caches it, so a retry usually succeeds quickly — it only frees the UI from
// waiting on a hung/slow download.
export function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new ShareTimeoutError()), ms);
    p.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

// ── Native share flow (driven by ShareHost) ─────────────────────────────────

// Resolve the asset to a shareable file:// URI plus its MIME. `getUri()`
// returns the original file path on device (Android: file:// in DCIM; iOS: the
// local PHAsset representation; with the `UriExtractor.swift` patch it downloads
// iCloud-offloaded originals). iCloud-resident originals can still throw here
// (e.g. offline) — the caller surfaces that as a friendly error.
//
// For iOS photos we copy the original (byte-for-byte, same format) into our own
// cache before sharing. iOS's share sheet generates the header thumbnail
// out-of-process and can't read the Photos-managed `fullSizeImageURL`, so
// sharing it directly shows a blank/white preview; a file in our sandbox previews
// correctly (same trick the framed flow's tmpfile relies on). Videos already
// preview fine from the original URL and can be large, so they're shared as-is.
export async function prepareRawShare(
  asset: Asset,
  isVideo: boolean
): Promise<{ uri: string; mimeType: string | undefined }> {
  const [uri, filename] = await Promise.all([
    asset.getUri(),
    asset.getFilename().catch(() => ''),
  ]);

  if (isVideo || Platform.OS !== 'ios') {
    return { uri, mimeType: mimeTypeForFilename(filename) };
  }

  try {
    const dest = new File(Paths.cache, `mems-share-original.${shareExtension(uri, filename)}`);
    await new File(uri).copy(dest, { overwrite: true });
    return { uri: dest.uri, mimeType: mimeTypeForFilename(dest.name) };
  } catch {
    // Copy failed (rare) — fall back to the original URL so sharing still works,
    // even if the share-sheet preview stays blank.
    return { uri, mimeType: mimeTypeForFilename(filename) };
  }
}

export async function shareFile(uri: string, mimeType?: string): Promise<void> {
  if (!(await Sharing.isAvailableAsync())) {
    throw new Error('Sharing is not available on this device');
  }
  await Sharing.shareAsync(uri, mimeType ? { mimeType } : undefined);
}
