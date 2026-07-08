import { Paths } from 'expo-file-system';

// iCloud downloads need disk headroom to land: below roughly a gigabyte free,
// iOS starts failing them outright (and purging Photos derivatives), so a photo
// that just failed to load is far more likely "the phone is full" than "the
// network broke". The recovery UI uses this to say so instead of a generic
// "Photo couldn't load".
export const CRITICAL_DISK_BYTES = 1024 * 1024 * 1024;

// Pure (unit tested): junk-tolerant threshold check.
export function isCriticalSpace(
  availableBytes: number | null | undefined,
  threshold: number = CRITICAL_DISK_BYTES
): boolean {
  return (
    typeof availableBytes === 'number' &&
    Number.isFinite(availableBytes) &&
    availableBytes >= 0 &&
    availableBytes < threshold
  );
}

// Cheap sync native read (statfs under the hood), guarded: an unavailable or
// failing read must never claim the disk is full.
export function isDiskSpaceCritical(): boolean {
  try {
    return isCriticalSpace(Paths.availableDiskSpace);
  } catch {
    return false;
  }
}
