// Copy for the Near Me "Setting up" note, kept pure so it's unit-testable and so
// the count formats consistently without relying on Intl (Hermes' Intl is
// limited). The note turns the one-time full index build from a bare spinner
// into a clear, moving "this is working" signal.

export type BuildProgress = { processed: number; total: number };

export const SETUP_NOTE_TITLE = 'Setting up Near Me';

// Points the user at the tab that already works, so the wait never reads as the
// whole app being stuck.
export const SETUP_NOTE_HINT = 'Your Camera Roll is ready to browse while this finishes.';

// Thousands separators without Intl: "9800" -> "9,800".
export function withCommas(n: number): string {
  return Math.max(0, Math.floor(n))
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export function setupNoteSubtitle(p: BuildProgress): string {
  if (p.total > 0 && p.processed < p.total) {
    return `Finding where your photos were taken… ${withCommas(p.processed)} of ${withCommas(
      p.total
    )}`;
  }
  // Before the count starts (build deferred) or once it's done: no scary number.
  return 'Finding where your photos were taken. This happens once.';
}
