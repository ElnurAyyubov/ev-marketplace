/**
 * Cosmetic road-routing overlay (TRIP_PLANNER_ADDENDUM.md §7, T4/stretch).
 * Runs strictly *after* the planner has chosen stops -- it only draws a
 * prettier line and a realistic ETA. It never feeds back into which
 * stations were picked, and any failure here is silent: the caller keeps
 * the straight-line plan unchanged.
 */
import { LatLng } from './types';

const OSRM_URL = process.env.OSRM_URL || 'https://router.project-osrm.org';
const ROAD_OVERLAY_ENABLED = process.env.TRIP_ROAD_OVERLAY !== 'false';

export interface RoadOverlay {
  roadGeometry: LatLng[];
  roadDistanceKm: number;
  etaMinutes: number;
}

interface OsrmRoute {
  distance: number; // meters
  duration: number; // seconds
  geometry: { coordinates: [number, number][] }; // [lng, lat] pairs, GeoJSON order
}

interface OsrmResponse {
  routes?: OsrmRoute[];
}

/** Never throws -- returns undefined on any failure or when disabled, so the caller can fall back to straight lines unconditionally. */
export async function getRoadOverlay(waypoints: LatLng[]): Promise<RoadOverlay | undefined> {
  if (!ROAD_OVERLAY_ENABLED || waypoints.length < 2) return undefined;

  try {
    const coords = waypoints.map((w) => `${w.lng},${w.lat}`).join(';');
    const url = `${OSRM_URL}/route/v1/driving/${coords}?overview=full&geometries=geojson`;
    const res = await fetch(url);
    if (!res.ok) return undefined;

    const data = (await res.json()) as OsrmResponse;
    const route = data.routes?.[0];
    if (!route) return undefined;

    return {
      roadGeometry: route.geometry.coordinates.map(([lng, lat]) => ({ lat, lng })),
      roadDistanceKm: route.distance / 1000,
      etaMinutes: route.duration / 60,
    };
  } catch {
    return undefined;
  }
}
