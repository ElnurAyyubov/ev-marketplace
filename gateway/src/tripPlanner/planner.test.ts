import { describe, expect, it } from 'vitest';
import { haversineKm } from '../geo';
import { DEFAULT_MAX_LEG_KM, planTrip, roadKm } from './planner';
import { LatLng, PlanConstraints, ProviderCandidate, ProviderQueryFn } from './types';

/**
 * Mimics the production queryFn (route layer): a bounding-box read
 * (haversine radius) filtered by the same constraint fields the real
 * gateway applies before the planner ever sees a candidate. Kept in the
 * test file, not planner.ts, because the planner itself never talks to
 * providers directly -- it only calls whatever ProviderQueryFn it's given.
 */
function seededQueryFn(providers: ProviderCandidate[]): ProviderQueryFn {
  return async (box, constraints: PlanConstraints) => {
    return providers
      .filter((p) => haversineKm(box.center.lat, box.center.lng, p.location.lat, p.location.lng) <= box.radiusKm)
      .filter((p) => !constraints.providerType || p.providerType === constraints.providerType)
      .filter((p) => constraints.maxPricePerkWh === undefined || p.pricePerkWh <= constraints.maxPricePerkWh)
      .filter((p) => constraints.approvalRequired === undefined || p.approvalRequired === constraints.approvalRequired)
      .filter(
        (p) =>
          !constraints.connectorTypes?.length ||
          p.connectorTypes.some((c) => constraints.connectorTypes!.includes(c))
      );
  };
}

function provider(id: string, location: LatLng, overrides: Partial<ProviderCandidate> = {}): ProviderCandidate {
  return {
    providerId: id,
    location,
    providerType: 'Commercial',
    pricePerkWh: 20,
    approvalRequired: false,
    connectorTypes: ['CCS'],
    ...overrides,
  };
}

// Scenario A: an on-equator corridor from O to a destination 6.5 degrees
// east, needing 3 stops at a default maxLegKm of 300. P1b is a decoy that
// makes more progress than P1 but is overpriced -- used only by the
// constraints test. Coordinates verified against the real haversineKm
// implementation (see PR description / commit for the derivation).
const O: LatLng = { lat: 0, lng: 0 };
const DEST_A: LatLng = { lat: 0, lng: 6.5 };
const P1C = provider('P1c', { lat: 0, lng: 1.0 });
const P1 = provider('P1', { lat: 0, lng: 2.0 });
const P1B_DECOY = provider('P1b-decoy', { lat: 0, lng: 2.04 }, { pricePerkWh: 999 });
const P2 = provider('P2', { lat: 0, lng: 4.0 });
const P3 = provider('P3', { lat: 0, lng: 6.0 });

describe('planTrip', () => {
  it('1. destination within maxLegKm of origin returns a feasible zero-stop plan', async () => {
    const origin = { lat: 0, lng: 0 };
    const destination = { lat: 0, lng: 1.0 }; // ~111km, well under the 300km default
    const plan = await planTrip({ origin, destination }, seededQueryFn([]));

    expect(plan.status).toBe('feasible');
    expect(plan.stops).toEqual([]);
    expect(plan.finalLegKm).toBeCloseTo(roadKm(origin, destination), 6);
    expect(plan.finalLegKm).toBeLessThanOrEqual(DEFAULT_MAX_LEG_KM);
    expect(plan.totalDistanceKm).toBeCloseTo(plan.finalLegKm, 6);
  });

  it('2. a route needing multiple stops returns an ordered, in-budget plan', async () => {
    const queryFn = seededQueryFn([P1C, P1, P2, P3]);
    const plan = await planTrip({ origin: O, destination: DEST_A }, queryFn);

    expect(plan.status).toBe('feasible');
    expect(plan.stops.map((s) => s.providerId)).toEqual(['P1', 'P2', 'P3']);
    for (const stop of plan.stops) {
      expect(stop.legDistanceKm).toBeLessThanOrEqual(DEFAULT_MAX_LEG_KM);
    }
    expect(plan.finalLegKm).toBeLessThanOrEqual(DEFAULT_MAX_LEG_KM);
    expect(plan.stopCount).toBe(3);
  });

  it('3. constraints actually filter candidates (price cap excludes the disqualified provider)', async () => {
    const allProviders = [P1C, P1, P1B_DECOY, P2, P3];

    // Unconstrained: the greedy walk prefers the decoy (more progress),
    // even though it's absurdly overpriced -- proves argmax works.
    const unconstrained = await planTrip({ origin: O, destination: DEST_A }, seededQueryFn(allProviders));
    expect(unconstrained.stops[0].providerId).toBe('P1b-decoy');

    // With a price cap, the decoy never reaches the candidate pool, so the
    // planner falls back to the next-best (cheaper) station instead.
    const constrained = await planTrip(
      { origin: O, destination: DEST_A, constraints: { maxPricePerkWh: 25 } },
      seededQueryFn(allProviders)
    );
    expect(constrained.stops.map((s) => s.providerId)).toEqual(['P1', 'P2', 'P3']);
    expect(constrained.stops.every((s) => s.pricePerkWh <= 25)).toBe(true);
  });

  it('4. an unreachable destination returns no_feasible_route with a reason and partial stops, never throws or an over-length leg', async () => {
    const farDestination = { lat: 0, lng: 20.0 };
    const queryFn = seededQueryFn([P1C, P1, P2, P3]);
    const plan = await planTrip({ origin: O, destination: farDestination }, queryFn);

    expect(plan.status).toBe('no_feasible_route');
    expect(plan.reason).toBeTruthy();
    expect(plan.stops.map((s) => s.providerId)).toEqual(['P1', 'P2', 'P3']);
    for (const stop of plan.stops) {
      expect(stop.legDistanceKm).toBeLessThanOrEqual(DEFAULT_MAX_LEG_KM);
    }
  });

  it('5. the same request run twice produces byte-identical stops (determinism)', async () => {
    const request = { origin: O, destination: DEST_A };
    const planA = await planTrip(request, seededQueryFn([P1C, P1, P2, P3]));
    const planB = await planTrip(request, seededQueryFn([P1C, P1, P2, P3]));

    expect(planA.stops).toEqual(planB.stops);
    expect(planA.status).toBe(planB.status);
    expect(planA.totalDistanceKm).toBe(planB.totalDistanceKm);
  });

  it('6. the stranding guard avoids a dead end that pure greedy walks into', async () => {
    // D makes more progress toward the destination than S does, so pure
    // greedy prefers it -- but D is a dead end (nothing qualifying is
    // reachable onward from it, and it can't reach the destination
    // directly either). S has less immediate progress but a valid path
    // onward through N. See scratchpad derivation for exact coordinates.
    const destination = { lat: 0, lng: 4.5 };
    const S = provider('S', { lat: 0, lng: 0.5 });
    const N = provider('N', { lat: 0, lng: 2.5 });
    const D = provider('D-deadend', { lat: 1.6959871045459547, lng: 1.0190518615002424 });
    const providers = [S, N, D];

    const guarded = await planTrip(
      { origin: O, destination, useStrandingGuard: true },
      seededQueryFn(providers)
    );
    expect(guarded.status).toBe('feasible');
    expect(guarded.stops.map((s) => s.providerId)).toEqual(['S', 'N']);

    const unguarded = await planTrip(
      { origin: O, destination, useStrandingGuard: false },
      seededQueryFn(providers)
    );
    expect(unguarded.status).toBe('no_feasible_route');
    expect(unguarded.stops.map((s) => s.providerId)).toEqual(['D-deadend']);
  });
});
