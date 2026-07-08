import {
  deriveFlags,
  initialLoadState,
  loadReducer,
  type LoadState,
} from '@/hooks/use-icloud-image-load';

const A = 'ph://asset-A';
const B = 'ph://asset-B';

describe('deriveFlags', () => {
  it('is all-false for a fresh state', () => {
    expect(deriveFlags(initialLoadState, A)).toEqual({
      imageReady: false,
      preview: false,
      showing: false,
      accessing: false,
      unreachable: false,
    });
  });

  it('reports imageReady only for the loaded asset', () => {
    const s: LoadState = { ...initialLoadState, loadedId: A };
    expect(deriveFlags(s, A).imageReady).toBe(true);
    expect(deriveFlags(s, B).imageReady).toBe(false);
  });

  it('reports preview/showing only for the matching, not-yet-final asset', () => {
    const s: LoadState = { ...initialLoadState, previewId: A };
    expect(deriveFlags(s, A)).toMatchObject({
      imageReady: false,
      preview: true,
      showing: true,
    });
    // Recycle safety: a different asset on the same view ignores A's preview.
    expect(deriveFlags(s, B)).toMatchObject({ preview: false, showing: false });
  });

  it('final load absorbs the preview (preview off, showing stays on)', () => {
    const s: LoadState = { ...initialLoadState, previewId: A, loadedId: A };
    expect(deriveFlags(s, A)).toMatchObject({
      imageReady: true,
      preview: false,
      showing: true,
    });
  });

  it('reports accessing only for the matching, not-yet-loaded asset', () => {
    const s: LoadState = { ...initialLoadState, accessingId: A };
    expect(deriveFlags(s, A).accessing).toBe(true);
    // Recycle safety: a different asset on the same view ignores A's flag.
    expect(deriveFlags(s, B).accessing).toBe(false);
  });

  it('reports unreachable only for the matching, not-yet-loaded asset', () => {
    const s: LoadState = { ...initialLoadState, unreachableId: A };
    expect(deriveFlags(s, A).unreachable).toBe(true);
    expect(deriveFlags(s, B).unreachable).toBe(false);
  });

  it('lets accessing coexist with a preview (hint pill over the blur)', () => {
    const s: LoadState = { ...initialLoadState, previewId: A, accessingId: A };
    expect(deriveFlags(s, A)).toMatchObject({
      preview: true,
      showing: true,
      accessing: true,
      imageReady: false,
    });
  });

  it('lets unreachable coexist with a preview (Retry pill over the blur)', () => {
    const s: LoadState = { ...initialLoadState, previewId: A, unreachableId: A };
    expect(deriveFlags(s, A)).toMatchObject({
      preview: true,
      showing: true,
      unreachable: true,
      imageReady: false,
    });
  });

  it('suppresses preview/accessing/unreachable once the same asset has loaded', () => {
    // A late timer could leave a stale accessing/unreachable id behind; a load
    // for that asset must still win.
    const s: LoadState = {
      ...initialLoadState,
      loadedId: A,
      previewId: A,
      accessingId: A,
      unreachableId: A,
    };
    expect(deriveFlags(s, A)).toEqual({
      imageReady: true,
      preview: false,
      showing: true,
      accessing: false,
      unreachable: false,
    });
  });
});

describe('loadReducer', () => {
  it('marks loaded', () => {
    const s = loadReducer(initialLoadState, { type: 'loaded', id: A });
    expect(s.loadedId).toBe(A);
  });

  it('marks preview', () => {
    const s = loadReducer(initialLoadState, { type: 'preview', id: A });
    expect(s.previewId).toBe(A);
    expect(deriveFlags(s, A)).toMatchObject({ preview: true, showing: true });
  });

  it('returns the same object reference for a no-op (lets React bail out)', () => {
    const loaded = loadReducer(initialLoadState, { type: 'loaded', id: A });
    expect(loadReducer(loaded, { type: 'loaded', id: A })).toBe(loaded);
    const preview = loadReducer(initialLoadState, { type: 'preview', id: A });
    expect(loadReducer(preview, { type: 'preview', id: A })).toBe(preview);
  });

  it('ignores a late preview for an already-final asset', () => {
    const loaded = loadReducer(initialLoadState, { type: 'loaded', id: A });
    expect(loadReducer(loaded, { type: 'preview', id: A })).toBe(loaded);
  });

  it('upgrades preview → loaded', () => {
    let s = loadReducer(initialLoadState, { type: 'preview', id: A });
    s = loadReducer(s, { type: 'loaded', id: A });
    expect(deriveFlags(s, A)).toMatchObject({
      imageReady: true,
      preview: false,
      showing: true,
    });
  });

  it('sets accessing then unreachable while not loaded', () => {
    let s = loadReducer(initialLoadState, { type: 'accessing', id: A });
    expect(deriveFlags(s, A).accessing).toBe(true);
    s = loadReducer(s, { type: 'unreachable', id: A });
    expect(deriveFlags(s, A).unreachable).toBe(true);
  });

  it('keeps accessing/unreachable settable while only a preview has landed', () => {
    let s = loadReducer(initialLoadState, { type: 'preview', id: A });
    s = loadReducer(s, { type: 'accessing', id: A });
    expect(deriveFlags(s, A)).toMatchObject({ preview: true, accessing: true });
    s = loadReducer(s, { type: 'unreachable', id: A });
    expect(deriveFlags(s, A)).toMatchObject({ preview: true, unreachable: true });
  });

  it('ignores accessing/unreachable for an already-loaded asset', () => {
    const loaded = loadReducer(initialLoadState, { type: 'loaded', id: A });
    expect(loadReducer(loaded, { type: 'accessing', id: A })).toBe(loaded);
    expect(loadReducer(loaded, { type: 'unreachable', id: A })).toBe(loaded);
  });

  it('retry clears only the matching asset (preview included) and bumps the nonce', () => {
    let s: LoadState = {
      loadedId: A,
      previewId: A,
      accessingId: A,
      unreachableId: A,
      reloadNonce: 0,
    };
    s = loadReducer(s, { type: 'retry', id: A });
    expect(s).toEqual({
      loadedId: null,
      previewId: null,
      accessingId: null,
      unreachableId: null,
      reloadNonce: 1,
    });
  });

  it('retry for a different asset leaves the other asset untouched (only bumps nonce)', () => {
    const s: LoadState = {
      loadedId: A,
      previewId: A,
      accessingId: A,
      unreachableId: A,
      reloadNonce: 2,
    };
    const next = loadReducer(s, { type: 'retry', id: B });
    expect(next).toEqual({
      loadedId: A,
      previewId: A,
      accessingId: A,
      unreachableId: A,
      reloadNonce: 3,
    });
  });

  it('runs a full stall→retry→load cycle', () => {
    let s = initialLoadState;
    s = loadReducer(s, { type: 'accessing', id: A });
    s = loadReducer(s, { type: 'unreachable', id: A });
    expect(deriveFlags(s, A)).toMatchObject({ unreachable: true, imageReady: false });

    s = loadReducer(s, { type: 'retry', id: A });
    expect(deriveFlags(s, A)).toMatchObject({
      unreachable: false,
      accessing: false,
      imageReady: false,
    });
    expect(s.reloadNonce).toBe(1);

    s = loadReducer(s, { type: 'loaded', id: A });
    expect(deriveFlags(s, A).imageReady).toBe(true);
  });

  it('runs the blur-then-stall recovery cycle (preview → unreachable → retry → final)', () => {
    // The offloaded-library path: blur lands fast, the full download stalls, the
    // deadline offers Retry over the blur, the retry attempt completes.
    let s = loadReducer(initialLoadState, { type: 'preview', id: A });
    s = loadReducer(s, { type: 'accessing', id: A });
    s = loadReducer(s, { type: 'unreachable', id: A });
    expect(deriveFlags(s, A)).toMatchObject({
      preview: true,
      showing: true,
      unreachable: true,
    });

    s = loadReducer(s, { type: 'retry', id: A });
    expect(deriveFlags(s, A)).toEqual({
      imageReady: false,
      preview: false,
      showing: false,
      accessing: false,
      unreachable: false,
    });

    s = loadReducer(s, { type: 'preview', id: A });
    s = loadReducer(s, { type: 'loaded', id: A });
    expect(deriveFlags(s, A)).toMatchObject({ imageReady: true, showing: true });
  });
});
