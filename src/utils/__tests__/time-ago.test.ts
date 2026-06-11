import { formatTimeAgo } from '@/utils/time-ago';

const DAY = 24 * 60 * 60 * 1000;
const YEAR = 365.25 * DAY;
const NOW = 1_800_000_000_000;

describe('formatTimeAgo', () => {
  it('returns empty string for null', () => {
    expect(formatTimeAgo(null, NOW)).toBe('');
  });

  it('returns "today" for under a day', () => {
    expect(formatTimeAgo(NOW - DAY + 1, NOW)).toBe('today');
  });

  it('formats whole days', () => {
    expect(formatTimeAgo(NOW - DAY, NOW)).toBe('1 day ago');
    expect(formatTimeAgo(NOW - 5 * DAY, NOW)).toBe('5 days ago');
  });

  it('formats whole years', () => {
    expect(formatTimeAgo(NOW - YEAR, NOW)).toBe('1 year ago');
    expect(formatTimeAgo(NOW - 2 * YEAR, NOW)).toBe('2 years ago');
  });

  it('formats years and days together', () => {
    expect(formatTimeAgo(NOW - (2 * YEAR + 3 * DAY), NOW)).toBe(
      '2 years, 3 days ago'
    );
    expect(formatTimeAgo(NOW - (YEAR + DAY), NOW)).toBe('1 year, 1 day ago');
  });
});
