// One place for "this await must not hang forever." Every native call that hits
// the OS (Photos, Location, iCloud, network) is bounded with these so a stalled
// call degrades to a fast, recoverable state instead of an infinite spinner.
//
// Important: a timeout does NOT cancel the underlying work — the native fetch
// keeps running and iOS caches its partial progress, so a retry usually lands
// quickly. The timeout only frees the UI from waiting.

export class TimeoutError extends Error {
  constructor(label?: string) {
    super(label ? `Timed out: ${label}` : 'Timed out');
    this.name = 'TimeoutError';
  }
}

/** Reject with `TimeoutError` if `p` hasn't settled within `ms`. */
export function withTimeout<T>(p: Promise<T>, ms: number, label?: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeoutError(label)), ms);
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

/** Resolve `fallback` if `p` doesn't settle within `ms` OR rejects — so a slow
 *  or failed probe can never block the caller. Use when "proceed with a safe
 *  default" beats surfacing an error (iCloud probes, best-effort reads). */
export function withTimeoutDefault<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    let settled = false;
    const finish = (v: T) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(v);
    };
    const timer = setTimeout(() => finish(fallback), ms);
    p.then(
      (value) => finish(value),
      () => finish(fallback)
    );
  });
}

/** Run `factory()`, retrying on rejection up to `retries` times with linear
 *  backoff (`baseMs * attempt`). Each attempt gets a fresh promise from the
 *  factory (never a shared, already-rejected one). Rejects with the last error. */
export async function withRetry<T>(
  factory: () => Promise<T>,
  retries: number,
  baseMs: number
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await factory();
    } catch (e) {
      lastErr = e;
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, baseMs * (attempt + 1)));
      }
    }
  }
  throw lastErr;
}
