import { setupNoteSubtitle, withCommas } from '@/lib/setup-note';

describe('withCommas', () => {
  it('formats small numbers unchanged', () => {
    expect(withCommas(0)).toBe('0');
    expect(withCommas(7)).toBe('7');
    expect(withCommas(999)).toBe('999');
  });

  it('groups thousands', () => {
    expect(withCommas(1000)).toBe('1,000');
    expect(withCommas(9800)).toBe('9,800');
    expect(withCommas(12345)).toBe('12,345');
    expect(withCommas(1234567)).toBe('1,234,567');
  });

  it('is defensive about junk input', () => {
    expect(withCommas(-5)).toBe('0');
    expect(withCommas(3.9)).toBe('3');
  });
});

describe('setupNoteSubtitle', () => {
  it('shows the live count while a build is in progress', () => {
    expect(setupNoteSubtitle({ processed: 3200, total: 9800 })).toBe(
      'Finding where your photos were taken… 3,200 of 9,800'
    );
  });

  it('shows the generic copy before the count starts (build deferred)', () => {
    expect(setupNoteSubtitle({ processed: 0, total: 0 })).toBe(
      'Finding where your photos were taken. This happens once.'
    );
  });

  it('shows the generic copy once the build is complete', () => {
    expect(setupNoteSubtitle({ processed: 9800, total: 9800 })).toBe(
      'Finding where your photos were taken. This happens once.'
    );
  });

  it('treats an over-count as complete (no count shown)', () => {
    expect(setupNoteSubtitle({ processed: 10000, total: 9800 })).not.toContain('of');
  });
});
