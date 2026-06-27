import { cardLoadPriority, NEIGHBOR_RADIUS } from '@/lib/feed-priority';

describe('cardLoadPriority', () => {
  it('scores the focused card high', () => {
    expect(cardLoadPriority(5, 5)).toBe('high');
    expect(cardLoadPriority(0, 0)).toBe('high');
  });

  it('scores immediate neighbors within the radius as normal', () => {
    for (let d = 1; d <= NEIGHBOR_RADIUS; d += 1) {
      expect(cardLoadPriority(5 + d, 5)).toBe('normal');
      expect(cardLoadPriority(5 - d, 5)).toBe('normal');
    }
  });

  it('scores cards beyond the neighbor radius as low', () => {
    expect(cardLoadPriority(5 + NEIGHBOR_RADIUS + 1, 5)).toBe('low');
    expect(cardLoadPriority(5 - NEIGHBOR_RADIUS - 1, 5)).toBe('low');
    expect(cardLoadPriority(0, 50)).toBe('low');
    expect(cardLoadPriority(9999, 0)).toBe('low');
  });

  it('treats unknown focus (currentIndex < 0) as all-low', () => {
    expect(cardLoadPriority(0, -1)).toBe('low');
    expect(cardLoadPriority(50, -1)).toBe('low');
  });

  it('has a sharp boundary exactly at the radius', () => {
    expect(cardLoadPriority(NEIGHBOR_RADIUS, 0)).toBe('normal');
    expect(cardLoadPriority(NEIGHBOR_RADIUS + 1, 0)).toBe('low');
  });

  it('is symmetric around the focused index', () => {
    for (let d = 0; d <= NEIGHBOR_RADIUS + 2; d += 1) {
      expect(cardLoadPriority(10 + d, 10)).toBe(cardLoadPriority(10 - d, 10));
    }
  });
});
