// Straight-line distance in km between two {latitude, longitude} points (haversine).
export function distanceKm(a, b) {
  if (!a || !b || [a.latitude, a.longitude, b.latitude, b.longitude].some((v) => typeof v !== "number")) return null;

  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.latitude - a.latitude);
  const dLon = rad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLon / 2) ** 2;

  return Number((2 * 6371 * Math.asin(Math.sqrt(h))).toFixed(2));
}

// Rough arrival time for a local ride: ~25 km/h average through town.
export const etaMinutes = (km) => (km == null ? null : Math.max(1, Math.round((km / 25) * 60)));
