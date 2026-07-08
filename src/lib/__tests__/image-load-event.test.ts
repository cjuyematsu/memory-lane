import type { ImageLoadEventData, ImageProgressEventData } from 'expo-image';

import {
  isPlaceholderLoad,
  isStaleLoadEvent,
  loadProgressFraction,
} from '@/lib/image-load-event';

const event = (extra: object = {}): ImageLoadEventData =>
  ({
    cacheType: 'none',
    source: { url: 'ph://x', width: 100, height: 100, mediaType: null, isAnimated: false },
    ...extra,
  }) as ImageLoadEventData;

describe('isPlaceholderLoad', () => {
  it('is true only for an explicit isPlaceholder: true', () => {
    expect(isPlaceholderLoad(event({ isPlaceholder: true }))).toBe(true);
  });

  it('is false for an explicit final delivery', () => {
    expect(isPlaceholderLoad(event({ isPlaceholder: false }))).toBe(false);
  });

  it('is false when the field is absent (Android, web, un-rebuilt iOS binary)', () => {
    expect(isPlaceholderLoad(event())).toBe(false);
  });

  it('is false for junk values (never mis-hold recovery on a final image)', () => {
    expect(isPlaceholderLoad(event({ isPlaceholder: 1 }))).toBe(false);
    expect(isPlaceholderLoad(event({ isPlaceholder: 'true' }))).toBe(false);
    expect(isPlaceholderLoad(event({ isPlaceholder: null }))).toBe(false);
  });

  it('is false for a missing event', () => {
    expect(isPlaceholderLoad(null)).toBe(false);
    expect(isPlaceholderLoad(undefined)).toBe(false);
  });
});

describe('isStaleLoadEvent', () => {
  const withUrl = (url: unknown): ImageLoadEventData =>
    event({ source: { url, width: 100, height: 100, mediaType: null, isAnimated: false } });

  it('flags a ph:// event for a different ph:// asset (recycled cell)', () => {
    expect(isStaleLoadEvent(withUrl('ph://old-asset'), 'ph://new-asset')).toBe(true);
  });

  it('passes the matching ph:// event', () => {
    expect(isStaleLoadEvent(withUrl('ph://x'), 'ph://x')).toBe(false);
  });

  it('never flags when the event url is missing or not ph:// (Android, network)', () => {
    expect(isStaleLoadEvent(withUrl(undefined), 'ph://x')).toBe(false);
    expect(isStaleLoadEvent(withUrl(null), 'ph://x')).toBe(false);
    expect(isStaleLoadEvent(withUrl('content://media/123'), 'ph://x')).toBe(false);
    expect(isStaleLoadEvent(withUrl('file:///tmp/a.jpg'), 'ph://x')).toBe(false);
  });

  it('never flags when the expected uri is not ph:// (Android asset ids)', () => {
    expect(isStaleLoadEvent(withUrl('ph://x'), 'content://media/123')).toBe(false);
  });

  it('never flags a missing event', () => {
    expect(isStaleLoadEvent(null, 'ph://x')).toBe(false);
    expect(isStaleLoadEvent(undefined, 'ph://x')).toBe(false);
  });
});

describe('loadProgressFraction', () => {
  const progressEvent = (extra: object): ImageProgressEventData =>
    ({ loaded: null, total: null, ...extra }) as unknown as ImageProgressEventData;

  it('prefers the native ph:// fraction', () => {
    expect(loadProgressFraction(progressEvent({ progress: 0.42 }))).toBe(0.42);
  });

  it('clamps out-of-range fractions', () => {
    expect(loadProgressFraction(progressEvent({ progress: 1.2 }))).toBe(1);
    expect(loadProgressFraction(progressEvent({ progress: -0.1 }))).toBe(0);
  });

  it('derives from byte counts when no fraction is present', () => {
    expect(loadProgressFraction(progressEvent({ loaded: 50, total: 200 }))).toBe(0.25);
  });

  it('is null when nothing usable is present', () => {
    expect(loadProgressFraction(progressEvent({}))).toBeNull();
    expect(loadProgressFraction(progressEvent({ progress: Number.NaN }))).toBeNull();
    expect(loadProgressFraction(progressEvent({ loaded: 50, total: 0 }))).toBeNull();
    expect(loadProgressFraction(null)).toBeNull();
    expect(loadProgressFraction(undefined)).toBeNull();
  });
});
