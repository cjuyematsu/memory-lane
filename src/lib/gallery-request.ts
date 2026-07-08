// Bridges "open the recreations gallery" from anywhere (currently the
// Settings sheet) to TopTabs, which owns the full-screen gallery overlay.
// Same tiny pub/sub shape as near-me-request.ts.

const subscribers = new Set<() => void>();

export function requestRecreationsGallery(): void {
  for (const fn of subscribers) fn();
}

export function subscribeGalleryRequest(cb: () => void): () => void {
  subscribers.add(cb);
  return () => {
    subscribers.delete(cb);
  };
}
