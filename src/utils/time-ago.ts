const DAY_MS = 24 * 60 * 60 * 1000;
const YEAR_MS = 365.25 * DAY_MS;

export function formatTimeAgo(creationTime: number | null, now: number = Date.now()): string {
  if (!creationTime) return '';
  const diff = now - creationTime;
  if (diff < DAY_MS) return 'today';

  const years = Math.floor(diff / YEAR_MS);
  const days = Math.floor((diff - years * YEAR_MS) / DAY_MS);

  if (years === 0) return `${days} day${days === 1 ? '' : 's'} ago`;
  if (days === 0) return `${years} year${years === 1 ? '' : 's'} ago`;
  return `${years} year${years === 1 ? '' : 's'}, ${days} day${days === 1 ? '' : 's'} ago`;
}
