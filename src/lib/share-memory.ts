import { useEffect, useState } from 'react';
import * as Sharing from 'expo-sharing';
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

// ── Native share flow (driven by ShareHost) ─────────────────────────────────

// Resolve the asset to a shareable file:// URI plus its MIME. `getUri()`
// returns the original file path on device (Android: file:// in DCIM; iOS: the
// local PHAsset representation). iCloud-resident originals can throw here — the
// caller surfaces that as a friendly error rather than caching a failure.
export async function prepareRawShare(
  asset: Asset
): Promise<{ uri: string; mimeType: string | undefined }> {
  const [uri, filename] = await Promise.all([
    asset.getUri(),
    asset.getFilename().catch(() => ''),
  ]);
  return { uri, mimeType: mimeTypeForFilename(filename) };
}

export async function shareFile(uri: string, mimeType?: string): Promise<void> {
  if (!(await Sharing.isAvailableAsync())) {
    throw new Error('Sharing is not available on this device');
  }
  await Sharing.shareAsync(uri, mimeType ? { mimeType } : undefined);
}
