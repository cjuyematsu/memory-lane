import { mimeTypeForFilename, shareOptionsFor } from '@/lib/share-memory';

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
