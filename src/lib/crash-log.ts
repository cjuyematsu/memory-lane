import { persistedFile, readPersisted } from '@/lib/persisted-file';

// Persistent last-error log. The June 30 TestFlight crash left no retrievable
// stack trace (native jetsam/CoreMedia faults never do, and the API wouldn't
// serve the JS ones), so field crashes were undiagnosable. This module keeps a
// small rotating on-disk record of the last JS errors (global handler, error
// boundaries, unhandled rejections) plus an in-memory breadcrumb ring flushed
// into each entry, so the next field report can be read straight off the
// device. Everything here must be crash-safe itself: every write path swallows
// its own errors, and recording is synchronous (a fatal may never get another
// tick).
const FILE = 'crash-log.json';
export const MAX_ENTRIES = 20;
const MAX_STACK_CHARS = 1500;
const MAX_MESSAGE_CHARS = 500;
const MAX_CRUMBS = 40;
// A pathological rejection loop (e.g. a failing poll) must not churn the disk
// all session; after this many rejection entries we stop recording that kind.
const MAX_REJECTION_ENTRIES = 5;

export type CrashKind = 'fatal' | 'error' | 'rejection' | 'boundary';

export type CrashEntry = {
  at: number;
  kind: CrashKind;
  tag?: string;
  name: string;
  message: string;
  stack?: string;
  crumbs?: string[];
};

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested).

export function describeError(
  err: unknown,
  maxStack: number = MAX_STACK_CHARS
): { name: string; message: string; stack?: string } {
  try {
    if (err instanceof Error) {
      return {
        name: err.name || 'Error',
        message: String(err.message ?? '').slice(0, MAX_MESSAGE_CHARS),
        stack: typeof err.stack === 'string' ? err.stack.slice(0, maxStack) : undefined,
      };
    }
    // Non-Error throwables (strings, objects, null). String() may itself throw
    // on a hostile toString; the outer catch covers that.
    return { name: typeof err, message: String(err).slice(0, MAX_MESSAGE_CHARS) };
  } catch {
    return { name: 'unknown', message: 'unprintable error' };
  }
}

export function appendEntry(
  entries: CrashEntry[],
  entry: CrashEntry,
  cap: number = MAX_ENTRIES
): CrashEntry[] {
  const next = [...entries, entry];
  return next.length > cap ? next.slice(next.length - cap) : next;
}

const KINDS: readonly CrashKind[] = ['fatal', 'error', 'rejection', 'boundary'];

function parseEntry(v: unknown): CrashEntry | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  if (typeof o.at !== 'number' || !Number.isFinite(o.at)) return null;
  if (typeof o.kind !== 'string' || !KINDS.includes(o.kind as CrashKind)) return null;
  if (typeof o.name !== 'string' || typeof o.message !== 'string') return null;
  const entry: CrashEntry = {
    at: o.at,
    kind: o.kind as CrashKind,
    name: o.name,
    message: o.message,
  };
  if (typeof o.tag === 'string') entry.tag = o.tag;
  if (typeof o.stack === 'string') entry.stack = o.stack;
  if (Array.isArray(o.crumbs)) {
    entry.crumbs = o.crumbs.filter((c): c is string => typeof c === 'string');
  }
  return entry;
}

export function parseCrashLog(text: string | null): CrashEntry[] {
  if (!text) return [];
  try {
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) return [];
    const out: CrashEntry[] = [];
    for (const v of parsed) {
      const entry = parseEntry(v);
      if (entry) out.push(entry);
    }
    return out;
  } catch {
    return [];
  }
}

export function formatCrashLog(entries: CrashEntry[]): string {
  if (entries.length === 0) return 'No errors recorded.';
  const lines: string[] = [`PastPic error log (${entries.length} entries, newest first)`];
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    const when = new Date(e.at).toISOString();
    const tag = e.tag ? ` (${e.tag})` : '';
    lines.push('', `[${when}] ${e.kind}${tag}`, `${e.name}: ${e.message}`);
    if (e.stack) lines.push(e.stack);
    if (e.crumbs && e.crumbs.length > 0) {
      lines.push('breadcrumbs:');
      for (const c of e.crumbs) lines.push(`  ${c}`);
    }
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Runtime state.

const launchAt = Date.now();
const crumbs: string[] = [];
let entries: CrashEntry[] = [];
let hydration: Promise<void> | null = null;
let initialized = false;
let rejectionCount = 0;

// Optional secondary sink (Sentry, see lib/sentry.ts) for the error classes
// that don't flow through the ErrorUtils chain: unhandled rejections (we own
// the Hermes tracker in release) and error-boundary catches. Registered as a
// callback so this module never imports the SDK — tests and dev stay clean.
let forwardError: ((err: unknown) => void) | null = null;

export function setCrashForwarder(fn: (err: unknown) => void): void {
  forwardError = fn;
}

export function breadcrumb(tag: string): void {
  try {
    crumbs.push(`${Date.now() - launchAt}ms ${tag}`);
    if (crumbs.length > MAX_CRUMBS) crumbs.splice(0, crumbs.length - MAX_CRUMBS);
  } catch {
    // never let telemetry throw
  }
}

function record(kind: CrashKind, tag: string | undefined, err: unknown): void {
  try {
    const d = describeError(err);
    const entry: CrashEntry = { at: Date.now(), kind, name: d.name, message: d.message };
    if (tag) entry.tag = tag;
    if (d.stack) entry.stack = d.stack;
    if (crumbs.length > 0) entry.crumbs = [...crumbs];
    // If this runs before hydration finished, `entries` holds only this
    // session's records; the write drops the older tail. Acceptable: the fresh
    // error is the one that matters, and blocking a fatal on a disk read is not
    // an option.
    entries = appendEntry(entries, entry);
    const f = persistedFile(FILE);
    if (!f.exists) f.create();
    f.write(JSON.stringify(entries));
  } catch {
    // ignore: the log must never be its own crash source
  }
}

export function logBoundaryError(tag: string, error: Error): void {
  record('boundary', tag, error);
  try {
    forwardError?.(error);
  } catch {
    // never let telemetry throw
  }
}

export async function getCrashLogText(): Promise<string> {
  try {
    await hydration;
  } catch {
    // hydration never rejects, but stay paranoid
  }
  return formatCrashLog(entries);
}

type GlobalErrorHandler = (error: unknown, isFatal?: boolean) => void;

export function initCrashReporting(): void {
  if (initialized) return;
  initialized = true;
  breadcrumb('launch');

  hydration = readPersisted(FILE)
    .then((text) => {
      const prior = parseCrashLog(text);
      // Anything recorded before hydration finished stays newest.
      entries = [...prior, ...entries].slice(-MAX_ENTRIES);
    })
    .catch(() => {});

  // Global JS error handler. Delegating to the previous handler is
  // load-bearing: in dev that's the redbox, in release it's RN's handler that
  // terminates the app properly on fatals. We must observe, never swallow.
  try {
    const errorUtils = (globalThis as { ErrorUtils?: {
      getGlobalHandler?: () => GlobalErrorHandler | undefined;
      setGlobalHandler?: (h: GlobalErrorHandler) => void;
    } }).ErrorUtils;
    if (errorUtils?.setGlobalHandler) {
      const prev = errorUtils.getGlobalHandler?.();
      errorUtils.setGlobalHandler((error, isFatal) => {
        record(isFatal ? 'fatal' : 'error', undefined, error);
        prev?.(error, isFatal);
      });
    }
  } catch {
    // ignore
  }

  // Unhandled promise rejections. Hermes has a built-in tracker; RN only wires
  // it up in dev (to LogBox), so installing ours in release costs nothing. In
  // dev we leave RN's own tracker alone so LogBox warnings keep working.
  if (!__DEV__) {
    try {
      const hermes = (globalThis as { HermesInternal?: {
        hasPromise?: () => boolean;
        enablePromiseRejectionTracker?: (opts: {
          allRejections: boolean;
          onUnhandled: (id: number, rejection: unknown) => void;
          onHandled: (id: number) => void;
        }) => void;
      } }).HermesInternal;
      if (hermes?.hasPromise?.() && hermes.enablePromiseRejectionTracker) {
        hermes.enablePromiseRejectionTracker({
          allRejections: true,
          onUnhandled: (_id, rejection) => {
            // Forward every rejection (Sentry dedupes client-side); only the
            // on-disk log is capped against pathological rejection loops.
            try {
              forwardError?.(rejection);
            } catch {
              // never let telemetry throw
            }
            if (rejectionCount >= MAX_REJECTION_ENTRIES) return;
            rejectionCount += 1;
            record('rejection', undefined, rejection);
          },
          onHandled: () => {},
        });
      }
    } catch {
      // ignore
    }
  }
}
