// Helper geo murni (tanpa dependency) — Live Location Alat Berat BATCH 2.
// Self-check: node scripts/check-haversine.mjs

const EARTH_RADIUS_M = 6371000;

// Jarak antar 2 titik lat/lng (derajat) dalam meter.
export function haversineMeters(lat1, lng1, lat2, lng2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Total jarak (meter) menyusuri titik-titik berurutan [[lat,lng,ts],...].
export function pathDistance(points) {
  if (!Array.isArray(points) || points.length < 2) return 0;
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += haversineMeters(points[i - 1][0], points[i - 1][1], points[i][0], points[i][1]);
  }
  return total;
}
