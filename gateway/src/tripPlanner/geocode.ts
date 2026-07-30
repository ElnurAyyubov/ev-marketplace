/**
 * Deterministic place-string -> coordinates lookup (TRIP_PLANNER_ADDENDUM.md
 * §6). Never called by the LLM path directly -- the model only ever emits a
 * place *name* (see nlPlan.ts); this is what turns that name into lat/lng
 * before the planner runs. A UX-layer, non-trust-critical step, same as the
 * existing map/location handling elsewhere in the app.
 */
import { LatLng } from './types';

const NOMINATIM_URL = process.env.NOMINATIM_URL || 'https://nominatim.openstreetmap.org';

// Nominatim's usage policy caps public-instance traffic at ~1 req/sec and
// requires an identifying User-Agent; a self-hosted instance can ignore both,
// which is why these are env-overridable rather than hardcoded.
const MIN_REQUEST_INTERVAL_MS = Number(process.env.NOMINATIM_MIN_INTERVAL_MS) || 1000;
const USER_AGENT = process.env.NOMINATIM_USER_AGENT || 'ev-charging-marketplace-trip-planner/1.0';

export class GeocodeError extends Error {
  constructor(public readonly place: string) {
    super(`could not resolve location "${place}"`);
  }
}

const cache = new Map<string, LatLng>();
let lastRequestAt = 0;

async function throttle(): Promise<void> {
  const wait = lastRequestAt + MIN_REQUEST_INTERVAL_MS - Date.now();
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  lastRequestAt = Date.now();
}

interface NominatimResult {
  lat: string;
  lon: string;
}

export async function geocode(place: string): Promise<LatLng> {
  const key = place.trim().toLowerCase();
  const cached = cache.get(key);
  if (cached) return cached;

  await throttle();

  let results: NominatimResult[];
  try {
    const url = `${NOMINATIM_URL}/search?format=json&limit=1&q=${encodeURIComponent(place)}`;
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
    if (!res.ok) throw new GeocodeError(place);
    results = (await res.json()) as NominatimResult[];
  } catch (err) {
    if (err instanceof GeocodeError) throw err;
    throw new GeocodeError(place);
  }

  if (!Array.isArray(results) || results.length === 0) {
    throw new GeocodeError(place);
  }

  const location: LatLng = { lat: Number(results[0].lat), lng: Number(results[0].lon) };
  if (!Number.isFinite(location.lat) || !Number.isFinite(location.lng)) {
    throw new GeocodeError(place);
  }

  cache.set(key, location);
  return location;
}
