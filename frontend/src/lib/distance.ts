import { LatLng } from '../api/types';

// Mirrors gateway/src/geo.ts haversineKm. Off-ledger presentation math only
// (CAR_LOCATION_ADDENDUM.md section 7) -- ordinary floats are correct here,
// unlike the fixed-point rule that applies to on-ledger values.
export function distanceKm(a: LatLng, b: LatLng): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
