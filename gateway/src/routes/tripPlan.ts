/**
 * Read-only trip-planner REST surface (TRIP_PLANNER_ADDENDUM.md §9). Never
 * writes to the ledger: QueryProviders is the only chaincode call made from
 * this file, and it is always evaluateTransaction, never submit.
 */
import { Router } from 'express';
import { withContract } from '../fabric';
import { boundingBoxSelector, haversineKm, LAT_LNG_SCALE } from '../geo';
import { geocode, GeocodeError } from '../tripPlanner/geocode';
import { narrateTripPlan } from '../tripPlanner/narrate';
import { parseTripQuery } from '../tripPlanner/nlPlan';
import { planTrip } from '../tripPlanner/planner';
import { getRoadOverlay } from '../tripPlanner/roadOverlay';
import { LatLng, PlanConstraints, ProviderQueryFn, TripPlan, Waypoint } from '../tripPlanner/types';
import { asyncHandler, HttpError, requireIdentity } from './util';

export const tripPlanRouter = Router();

interface ProviderDoc {
  providerId: string;
  providerType: 'Commercial' | 'Residential';
  latitude: number;
  longitude: number;
  pricePerkWh: number;
  approvalRequired: boolean;
  connectorTypes: string[];
  [key: string]: unknown;
}

/** The planner's only side effect: a bounding-box QueryProviders read, filtered by the request's constraints. */
function makeQueryFn(identity: string): ProviderQueryFn {
  return async (box, constraints) => {
    const selector: Record<string, unknown> = { docType: 'provider', status: 'Active' };
    if (constraints.providerType) selector.providerType = constraints.providerType;
    if (constraints.approvalRequired !== undefined) selector.approvalRequired = constraints.approvalRequired;
    if (constraints.maxPricePerkWh !== undefined) selector.pricePerkWh = { $lte: constraints.maxPricePerkWh };
    Object.assign(
      selector,
      boundingBoxSelector({ lat: box.center.lat, lng: box.center.lng, radiusKm: box.radiusKm })
    );

    const result = await withContract(identity, (contract) =>
      contract.evaluateTransaction('QueryProviders', JSON.stringify(selector))
    );
    const docs = JSON.parse(Buffer.from(result).toString('utf8')) as ProviderDoc[];

    // Bounding box is coarse (a rectangle); refine to the true haversine
    // radius here, same pattern as GET /providers.
    return docs
      .filter(
        (d) =>
          haversineKm(box.center.lat, box.center.lng, d.latitude / LAT_LNG_SCALE, d.longitude / LAT_LNG_SCALE) <=
          box.radiusKm
      )
      .filter(
        (d) =>
          !constraints.connectorTypes?.length ||
          d.connectorTypes.some((c) => constraints.connectorTypes!.includes(c))
      )
      .map((d) => ({
        providerId: d.providerId,
        location: { lat: d.latitude / LAT_LNG_SCALE, lng: d.longitude / LAT_LNG_SCALE },
        providerType: d.providerType,
        pricePerkWh: d.pricePerkWh,
        approvalRequired: d.approvalRequired,
        connectorTypes: d.connectorTypes,
      }));
  };
}

type EndpointInput = { lat: number; lng: number } | string;

function isValidEndpoint(v: unknown): v is EndpointInput {
  if (typeof v === 'string') return v.trim().length > 0;
  if (typeof v === 'object' && v !== null) {
    const o = v as Record<string, unknown>;
    return typeof o.lat === 'number' && typeof o.lng === 'number';
  }
  return false;
}

/** Strings are geocoded (§6); {lat,lng} is trusted as-is. The LLM path never reaches here with anything but a string (see nlPlan.ts). */
async function resolveWaypoint(input: EndpointInput): Promise<Waypoint> {
  if (typeof input === 'string') {
    const loc = await geocode(input);
    return { label: input, lat: loc.lat, lng: loc.lng };
  }
  return { lat: input.lat, lng: input.lng };
}

/** Cosmetic only (§7): runs after stops are already chosen and never changes them. */
async function attachRoadOverlay(plan: TripPlan): Promise<void> {
  if (plan.status !== 'feasible') return;
  const waypoints: LatLng[] = [plan.origin, ...plan.stops.map((s) => s.location), plan.destination];
  const overlay = await getRoadOverlay(waypoints);
  if (overlay) Object.assign(plan, overlay);
}

tripPlanRouter.post(
  '/trip/plan',
  asyncHandler(async (req, res) => {
    const identity = requireIdentity(req);
    const body = req.body as {
      origin?: unknown;
      destination?: unknown;
      maxLegKm?: number;
      constraints?: PlanConstraints;
      useStrandingGuard?: boolean;
    };

    if (!isValidEndpoint(body.origin) || !isValidEndpoint(body.destination)) {
      throw new HttpError(400, 'origin and destination are required, each either {lat,lng} or a place string');
    }

    let origin: Waypoint;
    let destination: Waypoint;
    try {
      origin = await resolveWaypoint(body.origin);
      destination = await resolveWaypoint(body.destination);
    } catch (err) {
      if (err instanceof GeocodeError) throw new HttpError(400, err.message);
      throw err;
    }

    const plan = await planTrip(
      {
        origin,
        destination,
        maxLegKm: body.maxLegKm,
        constraints: body.constraints ?? {},
        useStrandingGuard: body.useStrandingGuard,
      },
      makeQueryFn(identity)
    );

    await attachRoadOverlay(plan);
    res.json(plan);
  })
);

tripPlanRouter.post(
  '/trip/plan/nl',
  asyncHandler(async (req, res) => {
    const identity = requireIdentity(req);
    const { query } = (req.body ?? {}) as { query?: string };
    if (typeof query !== 'string' || !query.trim()) {
      throw new HttpError(400, 'query is required');
    }

    let parsed: Awaited<ReturnType<typeof parseTripQuery>>;
    try {
      parsed = await parseTripQuery(query);
    } catch {
      // Never fall through to an unparsed/unfiltered query -- fail closed.
      throw new HttpError(502, 'could not process natural-language trip request');
    }

    let origin: Waypoint;
    let destination: Waypoint;
    try {
      origin = await resolveWaypoint(parsed.origin);
      destination = await resolveWaypoint(parsed.destination);
    } catch (err) {
      if (err instanceof GeocodeError) throw new HttpError(400, err.message);
      throw err;
    }

    const plan = await planTrip({ origin, destination, constraints: parsed.constraints }, makeQueryFn(identity));
    await attachRoadOverlay(plan);

    // Narration failure is non-fatal: the plan is still useful without it.
    let narration: string | undefined;
    try {
      narration = await narrateTripPlan(plan);
    } catch {
      narration = undefined;
    }

    res.json({ plan, narration });
  })
);
