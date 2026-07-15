export const LAT_LNG_SCALE = 1_000_000;

export interface GeoCenter {
  lat: number;
  lng: number;
  radiusKm: number;
}

export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/**
 * Bounding box in degrees, then scaled to the chaincode's fixed-point
 * representation. Longitude degrees shrink with latitude, so widen the box
 * using cos(lat); clamp to avoid divide-by-huge near poles.
 */
export function boundingBoxSelector(center: GeoCenter): {
  latitude: { $gte: number; $lte: number };
  longitude: { $gte: number; $lte: number };
} {
  const latDelta = center.radiusKm / 111;
  const lngDelta = center.radiusKm / (111 * Math.max(Math.cos((center.lat * Math.PI) / 180), 0.01));
  return {
    latitude: {
      $gte: Math.round((center.lat - latDelta) * LAT_LNG_SCALE),
      $lte: Math.round((center.lat + latDelta) * LAT_LNG_SCALE),
    },
    longitude: {
      $gte: Math.round((center.lng - lngDelta) * LAT_LNG_SCALE),
      $lte: Math.round((center.lng + lngDelta) * LAT_LNG_SCALE),
    },
  };
}
