// User-facing options for the per-place reminder cooldown: once a place has
// surfaced its memory, how long before that same place may remind you again.
// This is the configurable face of cluster-cooldown.ts's window. Kept pure (no
// imports) so it's both unit-testable and importable from cluster-cooldown.ts
// without a cycle. Consumer copy never says "cluster" — it says "place".

export const DAY_MS = 24 * 60 * 60 * 1000;

// The shipped default — unchanged from the original hardcoded ~90 day window.
export const PLACE_COOLDOWN_DEFAULT_MS = 90 * DAY_MS;

// `ms: null` means "Only once": that place reminds you a single time, ever
// (silenced indefinitely). null survives a JSON round-trip; Infinity does not.
export type PlaceCooldownOption = { label: string; ms: number | null };

export const PLACE_COOLDOWN_OPTIONS: PlaceCooldownOption[] = [
  { label: '1 day', ms: 1 * DAY_MS },
  { label: '1 week', ms: 7 * DAY_MS },
  { label: '1 month', ms: 30 * DAY_MS },
  { label: '3 months', ms: 90 * DAY_MS }, // default
  { label: '1 year', ms: 365 * DAY_MS },
  { label: 'Only once', ms: null },
];

// The human label for a stored value; falls back to the default's label for any
// value not in the list (e.g. a future option removed from the set).
export function describeCooldown(ms: number | null): string {
  const match = PLACE_COOLDOWN_OPTIONS.find((o) => o.ms === ms);
  if (match) return match.label;
  const fallback = PLACE_COOLDOWN_OPTIONS.find((o) => o.ms === PLACE_COOLDOWN_DEFAULT_MS);
  return fallback?.label ?? '3 months';
}
