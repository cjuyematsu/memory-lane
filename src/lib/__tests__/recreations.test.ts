import {
  parseRecreations,
  serializeRecreations,
  type Recreation,
} from '@/lib/recreations';

const valid: Recreation = {
  id: 'rc-1720000000000-abc123',
  oldAssetId: 'ph://ABCD-1234',
  newPhotoFile: 'rc-1720000000000-abc123.jpg',
  capturedAt: 1720000000000,
  oldCreationTime: 1500000000000,
  oldLocation: { latitude: 34.05, longitude: -118.24 },
  primary: 'now',
  capturedDistanceM: 42,
};

describe('serializeRecreations / parseRecreations', () => {
  it('round-trips a list of recreations', () => {
    const other: Recreation = {
      ...valid,
      id: 'rc-2',
      newPhotoFile: 'rc-2.jpg',
      oldCreationTime: null,
      oldLocation: null,
    };
    const items = [valid, other];
    expect(parseRecreations(serializeRecreations(items))).toEqual(items);
  });

  it('round-trips an empty list', () => {
    expect(parseRecreations(serializeRecreations([]))).toEqual([]);
  });
});

describe('parseRecreations tolerance', () => {
  it('returns [] for null text (no file yet)', () => {
    expect(parseRecreations(null)).toEqual([]);
  });

  it('returns [] for corrupt JSON', () => {
    expect(parseRecreations('{not json')).toEqual([]);
  });

  it('returns [] for non-object JSON', () => {
    expect(parseRecreations('42')).toEqual([]);
    expect(parseRecreations('"hi"')).toEqual([]);
    expect(parseRecreations('null')).toEqual([]);
  });

  it('starts fresh on an unknown store version', () => {
    expect(
      parseRecreations(JSON.stringify({ version: 99, items: [valid] }))
    ).toEqual([]);
  });

  it('returns [] when items is not an array', () => {
    expect(
      parseRecreations(JSON.stringify({ version: 1, items: { a: 1 } }))
    ).toEqual([]);
  });

  it('drops malformed entries but keeps valid ones', () => {
    const text = JSON.stringify({
      version: 1,
      items: [
        valid,
        null,
        'junk',
        { ...valid, id: '' }, // empty id
        { ...valid, newPhotoFile: undefined }, // missing file
        { ...valid, capturedAt: 'yesterday' }, // wrong type
      ],
    });
    expect(parseRecreations(text)).toEqual([valid]);
  });

  it('defaults primary to now for rows written before the field existed', () => {
    const { primary: _dropped, ...legacy } = valid;
    const text = JSON.stringify({
      version: 1,
      items: [legacy, { ...valid, id: 'rc-2', primary: 'then' }, { ...valid, id: 'rc-3', primary: 'sideways' }],
    });
    const parsed = parseRecreations(text);
    expect(parsed.map((r) => r.primary)).toEqual(['now', 'then', 'now']);
  });

  it('defaults capturedDistanceM to null when missing or invalid', () => {
    const { capturedDistanceM: _dropped, ...legacy } = valid;
    const text = JSON.stringify({
      version: 1,
      items: [legacy, { ...valid, id: 'rc-2', capturedDistanceM: -5 }, { ...valid, id: 'rc-3', capturedDistanceM: 'far' }],
    });
    const parsed = parseRecreations(text);
    expect(parsed.map((r) => r.capturedDistanceM)).toEqual([null, null, null]);
  });

  it('nulls out invalid optional fields instead of dropping the entry', () => {
    const text = JSON.stringify({
      version: 1,
      items: [
        { ...valid, oldCreationTime: 'old' },
        { ...valid, id: 'rc-3', oldLocation: { latitude: 1 } }, // missing longitude
      ],
    });
    const parsed = parseRecreations(text);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].oldCreationTime).toBeNull();
    expect(parsed[0].oldLocation).toEqual(valid.oldLocation);
    expect(parsed[1].oldLocation).toBeNull();
  });
});
