/**
 * Deterministic corridor-greedy trip planner (TRIP_PLANNER_ADDENDUM.md §4).
 * A pure function of (request, queryFn): every planning decision is made
 * from haversine distance and a fixed per-leg cap, never from a live
 * battery model, randomness, or the LLM. Road-routing is a cosmetic overlay
 * layered on afterwards (see roadOverlay.ts) and never feeds back in here.
 */
import { haversineKm } from '../geo';
import {
  LatLng,
  PlanConstraints,
  PlannedStop,
  PlanRequest,
  ProviderCandidate,
  ProviderQueryFn,
  TripPlan,
} from './types';

export const DEFAULT_MAX_LEG_KM = 300;
export const DETOUR = 1.3;

export function roadKm(a: LatLng, b: LatLng): number {
  return haversineKm(a.lat, a.lng, b.lat, b.lng) * DETOUR;
}

/** Positive means `cand` is closer to `dest` than `from` is — forward progress, not backtrack. */
export function progressKm(from: LatLng, cand: LatLng, dest: LatLng): number {
  return haversineKm(from.lat, from.lng, dest.lat, dest.lng) - haversineKm(cand.lat, cand.lng, dest.lat, dest.lng);
}

/**
 * One-step lookahead used by the stranding guard: from candidate `p`, is
 * there anywhere to go next (the destination itself, or another qualifying
 * station making further progress)? This is what keeps the greedy walk from
 * picking the single farthest station only to find it's a dead end.
 */
async function hasOnwardOption(
  p: ProviderCandidate,
  destination: LatLng,
  maxLegKm: number,
  constraints: PlanConstraints,
  queryFn: ProviderQueryFn
): Promise<boolean> {
  if (roadKm(p.location, destination) <= maxLegKm) return true;
  const onward = await queryFn({ center: p.location, radiusKm: maxLegKm }, constraints);
  return onward.some(
    (q) => roadKm(p.location, q.location) <= maxLegKm && progressKm(p.location, q.location, destination) > 0
  );
}

function buildPlan(
  request: PlanRequest,
  stops: PlannedStop[],
  finalLegKm: number,
  status: TripPlan['status'],
  reason?: string
): TripPlan {
  const maxLegKm = request.maxLegKm ?? DEFAULT_MAX_LEG_KM;
  const totalDistanceKm = stops.reduce((sum, s) => sum + s.legDistanceKm, 0) + finalLegKm;
  return {
    origin: request.origin,
    destination: request.destination,
    constraints: request.constraints ?? {},
    maxLegKm,
    status,
    ...(reason !== undefined ? { reason } : {}),
    stops,
    finalLegKm,
    totalDistanceKm,
    stopCount: stops.length,
  };
}

export async function planTrip(request: PlanRequest, queryFn: ProviderQueryFn): Promise<TripPlan> {
  const maxLegKm = request.maxLegKm ?? DEFAULT_MAX_LEG_KM;
  const constraints = request.constraints ?? {};
  const useStrandingGuard = request.useStrandingGuard ?? true;
  const { destination } = request;

  let current: LatLng = request.origin;
  const stops: PlannedStop[] = [];

  // Forward progress is required on every step (see the progressKm filter
  // below), so `current` is strictly closer to `destination` each
  // iteration and a station, once passed, can never qualify again --
  // termination is guaranteed given finitely many qualifying providers.
  for (;;) {
    const remaining = roadKm(current, destination);
    if (remaining <= maxLegKm) {
      return buildPlan(request, stops, remaining, 'feasible');
    }

    const raw = await queryFn({ center: current, radiusKm: maxLegKm }, constraints);
    const candidates = raw
      .filter((p) => roadKm(current, p.location) <= maxLegKm)
      .filter((p) => progressKm(current, p.location, destination) > 0);

    let pool = candidates;
    if (useStrandingGuard) {
      const safe: ProviderCandidate[] = [];
      for (const p of candidates) {
        if (await hasOnwardOption(p, destination, maxLegKm, constraints, queryFn)) safe.push(p);
      }
      if (safe.length > 0) pool = safe;
    }

    if (pool.length === 0) {
      const reason = `no qualifying station within ${maxLegKm}km of (${current.lat.toFixed(4)}, ${current.lng.toFixed(4)}) toward destination`;
      return buildPlan(request, stops, remaining, 'no_feasible_route', reason);
    }

    const next = pool.reduce((best, p) =>
      progressKm(current, p.location, destination) > progressKm(current, best.location, destination) ? p : best
    );

    stops.push({
      providerId: next.providerId,
      location: next.location,
      providerType: next.providerType,
      pricePerkWh: next.pricePerkWh,
      approvalRequired: next.approvalRequired,
      legDistanceKm: roadKm(current, next.location),
    });
    current = next.location;
  }
}
