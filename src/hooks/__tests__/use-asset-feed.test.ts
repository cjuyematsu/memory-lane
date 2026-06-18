import { sameAssetIds } from '@/hooks/use-asset-feed';
import type { Asset } from 'expo-media-library';

// use-asset-feed value-imports expo-media-library and expo-file-system at the
// top level; sameAssetIds touches neither, so stub them out (the real native
// modules can't load under jest). jest hoists these mocks above the imports.
jest.mock('expo-media-library', () => ({
  addListener: jest.fn(() => ({ remove: jest.fn() })),
  Album: { get: jest.fn() },
  AssetField: { MEDIA_TYPE: 'mediaType', CREATION_TIME: 'creationTime' },
  MediaSubtype: { SCREENSHOT: 'screenshot' },
  MediaType: { IMAGE: 'photo', VIDEO: 'video' },
  Query: class {},
}));
jest.mock('expo-file-system', () => ({
  File: class {},
  Paths: { cache: '/cache', document: '/doc' },
}));

const a = (id: string) => ({ id }) as Asset;

describe('sameAssetIds', () => {
  it('is true for the same reference', () => {
    const list = [a('1'), a('2')];
    expect(sameAssetIds(list, list)).toBe(true);
  });

  it('is true for equal ordered ids in different arrays', () => {
    expect(sameAssetIds([a('1'), a('2')], [a('1'), a('2')])).toBe(true);
  });

  it('is false when lengths differ', () => {
    expect(sameAssetIds([a('1')], [a('1'), a('2')])).toBe(false);
  });

  it('is false when an id differs', () => {
    expect(sameAssetIds([a('1'), a('2')], [a('1'), a('9')])).toBe(false);
  });

  it('is order-sensitive (a new newest photo prepends)', () => {
    expect(sameAssetIds([a('1'), a('2')], [a('2'), a('1')])).toBe(false);
  });

  it('is true for two empty lists', () => {
    expect(sameAssetIds([], [])).toBe(true);
  });
});
