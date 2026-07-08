type Coords = { latitude: number; longitude: number };

const EARTH_RADIUS_M = 6_371_000;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

export function distanceMeters(a: Coords, b: Coords): number {
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

// GPS fixes are only good to tens of meters, so under this the user is, for
// all practical purposes, standing where the original photo was taken.
const AT_THE_SPOT_M = 50;

// Distance label without the unit suffix: meters rounded to 10 under a km,
// one-decimal km under 10 km, whole km beyond ("1608.2 km" is noise at that
// range). Returns null when there's nothing sensible to show.
function distanceLabel(meters: number | null): string | null {
  if (meters == null || !Number.isFinite(meters) || meters < 0) return null;
  const rounded10 = Math.round(meters / 10) * 10;
  if (rounded10 < 1000) return `${rounded10} m`;
  if (meters < 10_000) {
    const km = Math.round(meters / 100) / 10;
    return `${Number.isInteger(km) ? km.toFixed(0) : km.toFixed(1)} km`;
  }
  return `${Math.round(meters / 1000)} km`;
}

// The recreation camera's soft proximity hint: how far the user is from the
// original photo's spot. Never a gate — just context. null in (no GPS on the
// old photo, or no current fix) → null out (render nothing). Pure.
export function formatDistanceHint(meters: number | null): string | null {
  if (meters != null && Number.isFinite(meters) && meters >= 0 && meters < AT_THE_SPOT_M) {
    return 'Same spot';
  }
  const label = distanceLabel(meters);
  return label ? `${label} from the original` : null;
}

// Compact form for captions and the composite's on-photo chip, where "from
// the original" would be too long. Same banding as formatDistanceHint. Pure.
export function formatDistanceShort(meters: number | null): string | null {
  if (meters != null && Number.isFinite(meters) && meters >= 0 && meters < AT_THE_SPOT_M) {
    return 'same spot';
  }
  const label = distanceLabel(meters);
  return label ? `${label} away` : null;
}
