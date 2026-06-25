import {
  computeShareFrame,
  MIN_FRAME_RATIO,
  mimeTypeForFilename,
  RAW_SHARE_TIMEOUT_MS,
  SHARE_LAYOUT,
  STORY_CANVAS,
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

describe('STORY_CANVAS', () => {
  it('is the 1080×1920 (9:16) social upload size', () => {
    expect(STORY_CANVAS.width).toBe(1080);
    expect(STORY_CANVAS.height).toBe(1920);
    expect(STORY_CANVAS.aspect).toBeCloseTo(1080 / 1920);
  });
});

describe('computeShareFrame', () => {
  // Recreate the available box the same way the function does, so assertions can
  // check the frame is fully contained.
  const avail = (canvasW: number, canvasH: number) => ({
    w: canvasW - 2 * canvasW * SHARE_LAYOUT.marginFrac,
    h:
      canvasH -
      2 * canvasH * SHARE_LAYOUT.vPadFrac -
      canvasW * SHARE_LAYOUT.captionReserveFrac -
      canvasH * SHARE_LAYOUT.liftFrac,
  });

  it('uses the full content width for a portrait photo in the 9:16 story canvas', () => {
    const W = 360;
    const H = 640; // 9:16
    const { frameW, frameH, cropped } = computeShareFrame(W, H, 0.75);
    const a = avail(W, H);
    expect(frameW).toBeCloseTo(a.w); // width-constrained → photo stays large
    expect(frameH).toBeLessThanOrEqual(a.h + 0.001);
    expect(frameW / frameH).toBeCloseTo(0.75); // shape preserved
    expect(cropped).toBe(false);
  });

  it('drives off the height when a photo would overflow (e.g. a squarer canvas)', () => {
    const W = 360;
    const H = 360; // 1:1 — exercises the height-constrained branch
    const { frameW, frameH } = computeShareFrame(W, H, 0.75);
    const a = avail(W, H);
    expect(frameH).toBeCloseTo(a.h); // height-constrained
    expect(frameW).toBeLessThanOrEqual(a.w + 0.001);
    expect(frameW / frameH).toBeCloseTo(0.75); // shape still preserved
  });

  it('clamps and cover-crops a photo taller than MIN_FRAME_RATIO', () => {
    const { frameW, frameH, cropped } = computeShareFrame(360, 640, 0.4);
    expect(cropped).toBe(true);
    expect(frameW / frameH).toBeCloseTo(MIN_FRAME_RATIO);
  });

  it('never lets the frame exceed the available box across aspect ratios', () => {
    const W = 360;
    const H = Math.round(W / STORY_CANVAS.aspect);
    const a = avail(W, H);
    for (const ratio of [0.3, 0.5, 0.75, 1, 1.5, 2.5]) {
      const { frameW, frameH } = computeShareFrame(W, H, ratio);
      expect(frameW).toBeLessThanOrEqual(a.w + 0.001);
      expect(frameH).toBeLessThanOrEqual(a.h + 0.001);
    }
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
