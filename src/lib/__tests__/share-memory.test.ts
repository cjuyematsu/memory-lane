import {
  mimeTypeForFilename,
  RAW_SHARE_TIMEOUT_MS,
  ShareTimeoutError,
  shareExtension,
  shareOptionsFor,
  withTimeout,
} from '@/lib/share-memory';

describe('shareOptionsFor', () => {
  it('offers raw + framed for photos, in that order', () => {
    const opts = shareOptionsFor(false);
    expect(opts.map((o) => o.mode)).toEqual(['raw', 'framed']);
    expect(opts[0].label).toBe('Share photo');
    expect(opts[1].label).toBe('Share with caption');
  });

  it('offers raw-only for videos (no framed-with-caption still)', () => {
    const opts = shareOptionsFor(true);
    expect(opts).toEqual([{ mode: 'raw', label: 'Share video' }]);
  });
});

describe('mimeTypeForFilename', () => {
  it('maps common image and video extensions, case-insensitively', () => {
    expect(mimeTypeForFilename('IMG_1234.JPG')).toBe('image/jpeg');
    expect(mimeTypeForFilename('photo.jpeg')).toBe('image/jpeg');
    expect(mimeTypeForFilename('shot.png')).toBe('image/png');
    expect(mimeTypeForFilename('live.HEIC')).toBe('image/heic');
    expect(mimeTypeForFilename('anim.gif')).toBe('image/gif');
    expect(mimeTypeForFilename('pic.webp')).toBe('image/webp');
    expect(mimeTypeForFilename('clip.MOV')).toBe('video/quicktime');
    expect(mimeTypeForFilename('clip.mp4')).toBe('video/mp4');
    expect(mimeTypeForFilename('clip.m4v')).toBe('video/mp4');
  });

  it('returns undefined for unknown, extensionless, or empty names', () => {
    expect(mimeTypeForFilename('memory')).toBeUndefined();
    expect(mimeTypeForFilename('archive.zip')).toBeUndefined();
    expect(mimeTypeForFilename('')).toBeUndefined();
  });
});

describe('shareExtension', () => {
  it('prefers the resolved URI extension over the filename', () => {
    // Edited photo: getUri() yields a rendered JPEG even though the asset is HEIC.
    expect(shareExtension('file:///tmp/render.jpg', 'IMG_1.HEIC')).toBe('jpg');
  });

  it('falls back to the filename extension when the URI has none', () => {
    expect(shareExtension('file:///var/photo', 'IMG_1.HEIC')).toBe('heic');
  });

  it('ignores query/fragment on the URI', () => {
    expect(shareExtension('file:///x/pic.png?v=2', '')).toBe('png');
  });

  it('defaults to jpg when neither has an extension', () => {
    expect(shareExtension('file:///x/photo', 'photo')).toBe('jpg');
  });

  it('lowercases the extension', () => {
    expect(shareExtension('file:///x/PIC.JPEG', '')).toBe('jpeg');
  });
});

describe('withTimeout', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('resolves with the value when the promise settles before the deadline', async () => {
    const p = withTimeout(Promise.resolve('ok'), RAW_SHARE_TIMEOUT_MS);
    await expect(p).resolves.toBe('ok');
  });

  it('propagates the original rejection when it settles before the deadline', async () => {
    const boom = new Error('boom');
    const p = withTimeout(Promise.reject(boom), RAW_SHARE_TIMEOUT_MS);
    await expect(p).rejects.toBe(boom);
  });

  it('rejects with ShareTimeoutError once the deadline passes', async () => {
    // A promise that never settles on its own — only the timer can reject it.
    const p = withTimeout(new Promise(() => {}), 1000);
    jest.advanceTimersByTime(1000);
    await expect(p).rejects.toBeInstanceOf(ShareTimeoutError);
  });

  it('does not fire the timeout when the promise wins the race', async () => {
    const p = withTimeout(Promise.resolve('fast'), 1000);
    await expect(p).resolves.toBe('fast');
    // Advancing past the deadline must not produce an unhandled rejection.
    jest.advanceTimersByTime(2000);
  });
});
