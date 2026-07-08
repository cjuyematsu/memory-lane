import { pendingWarmDownload, planWarmMounts, type WarmEntry } from '@/lib/feed-warm-plan';

const local = (id: string): WarmEntry => ({ id, inCloud: false });
const cloud = (id: string): WarmEntry => ({ id, inCloud: true });
const none = new Set<string>();

describe('planWarmMounts', () => {
  it('mounts everything when all entries are on-device', () => {
    const entries = [local('a'), local('b'), local('c')];
    expect(planWarmMounts(entries, none)).toEqual(['a', 'b', 'c']);
  });

  it('mounts only the FIRST pending cloud entry among many (queue order)', () => {
    const entries = [cloud('a'), cloud('b'), cloud('c')];
    expect(planWarmMounts(entries, none)).toEqual(['a']);
  });

  it('mounts on-device entries freely around a single pending cloud download', () => {
    const entries = [local('a'), cloud('b'), local('c'), cloud('d')];
    expect(planWarmMounts(entries, none)).toEqual(['a', 'b', 'c']);
  });

  it('keeps a downloaded cloud entry mounted and admits the next pending one', () => {
    const entries = [cloud('a'), cloud('b'), cloud('c')];
    expect(planWarmMounts(entries, new Set(['a']))).toEqual(['a', 'b']);
    expect(planWarmMounts(entries, new Set(['a', 'b']))).toEqual(['a', 'b', 'c']);
  });

  it('handles empty input', () => {
    expect(planWarmMounts([], none)).toEqual([]);
  });

  it('mounts NO pending download while paused (renderables unaffected)', () => {
    const entries = [local('a'), cloud('b'), local('c'), cloud('d')];
    expect(planWarmMounts(entries, none, false)).toEqual(['a', 'c']);
  });

  it('while paused, already-downloaded cloud entries stay mounted (still renderable)', () => {
    const entries = [cloud('a'), cloud('b')];
    expect(planWarmMounts(entries, new Set(['a']), false)).toEqual(['a']);
  });

  it('resumes the download slot when the pause lifts', () => {
    const entries = [cloud('a'), cloud('b')];
    expect(planWarmMounts(entries, none, false)).toEqual([]);
    expect(planWarmMounts(entries, none, true)).toEqual(['a']);
  });
});

describe('pendingWarmDownload', () => {
  it('is null with no cloud entries', () => {
    expect(pendingWarmDownload([local('a'), local('b')], none)).toBeNull();
  });

  it('is the first not-yet-loaded cloud entry', () => {
    const entries = [local('a'), cloud('b'), cloud('c')];
    expect(pendingWarmDownload(entries, none)).toBe('b');
  });

  it('advances as downloads complete, then settles to null', () => {
    const entries = [cloud('a'), cloud('b')];
    expect(pendingWarmDownload(entries, new Set(['a']))).toBe('b');
    expect(pendingWarmDownload(entries, new Set(['a', 'b']))).toBeNull();
  });

  it('matches what planWarmMounts admits as the download slot', () => {
    const entries = [local('a'), cloud('b'), cloud('c')];
    const loaded = new Set(['b']);
    const pending = pendingWarmDownload(entries, loaded);
    expect(pending).toBe('c');
    expect(planWarmMounts(entries, loaded)).toContain(pending as string);
  });

  it('handles empty input', () => {
    expect(pendingWarmDownload([], none)).toBeNull();
  });
});
