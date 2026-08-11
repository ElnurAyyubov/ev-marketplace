/**
 * Trip-planner REST surface. `/trip/plan` and `/trip/plan/nl`
 * (TRIP_PLANNER_ADDENDUM.md §9) are read-only: QueryProviders is their only
 * chaincode call, always evaluateTransaction, never submit.
 * `/trip/plan/reserve` and `/trip/plan/cancel`
 * (TRIP_RESERVATION_ADDENDUM.md §6) do write, via ReserveTripLegs/CancelTripLegs.
 */
import { GatewayError } from '@hyperledger/fabric-gateway';
import { Router } from 'express';
import { withContract, withTransientContract } from '../fabric';
import { boundingBoxSelector, haversineKm, LAT_LNG_SCALE } from '../geo';
import { geocode, GeocodeError } from '../tripPlanner/geocode';
import { narrateTripPlan } from '../tripPlanner/narrate';
import { parseTripQuery } from '../tripPlanner/nlPlan';
import { planTrip } from '../tripPlanner/planner';
import { getRoadOverlay } from '../tripPlanner/roadOverlay';
import { LatLng, PlanConstraints, ProviderQueryFn, TripPlan, Waypoint } from '../tripPlanner/types';
import { computeWindows } from '../tripPlanner/windowPlan';
import { asyncHandler, HttpError, requireIdentity, unwrapChaincodeMessage } from './util';

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
      .filter((d) => !constraints.excludeProviders?.includes(d.providerId))
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

// ==================== Trip reservation (TRIP_RESERVATION_ADDENDUM.md §6) ====================

interface ReserveProviderDoc {
  providerId: string;
  status: string;
  approvalRequired: boolean;
  pricePerkWh: number;
  [key: string]: unknown;
}

interface ChargerDoc {
  chargerId: string;
  providerId: string;
  slotIndex: number;
  ratedPowerKw: number;
  status: string;
  [key: string]: unknown;
}

interface UnresolvedLeg {
  providerId: string;
  location: LatLng;
  requestedEnergyWh: number;
}

interface ResolvedLeg {
  providerId: string;
  slotIndex: number;
  requestedEnergyWh: number;
  windowStart: number;
  windowEnd: number;
}

interface TripLegFailure {
  failedLegIndex: number;
  providerId: string;
  reason: string;
}

function isLatLng(v: unknown): v is LatLng {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return typeof o.lat === 'number' && typeof o.lng === 'number';
}

async function fetchProvider(identity: string, providerId: string): Promise<ReserveProviderDoc> {
  const result = await withContract(identity, (contract) => contract.evaluateTransaction('GetProvider', providerId));
  return JSON.parse(Buffer.from(result).toString('utf8')) as ReserveProviderDoc;
}

async function fetchActiveChargers(identity: string, providerId: string): Promise<ChargerDoc[]> {
  const result = await withContract(identity, (contract) =>
    contract.evaluateTransaction('QueryChargersByProvider', providerId)
  );
  const chargers = JSON.parse(Buffer.from(result).toString('utf8')) as ChargerDoc[];
  return chargers.filter((c) => c.status === 'Active').sort((a, b) => a.slotIndex - b.slotIndex);
}

async function fetchOccupiedBuckets(
  identity: string,
  providerId: string,
  slotIndex: number,
  fromTs: number,
  toTs: number
): Promise<number[]> {
  const result = await withContract(identity, (contract) =>
    contract.evaluateTransaction('GetSlotAvailability', providerId, String(slotIndex), String(fromTs), String(toTs))
  );
  return JSON.parse(Buffer.from(result).toString('utf8')) as number[];
}

/**
 * Sequentially resolves each leg's slot and window (TRIP_RESERVATION_ADDENDUM.md
 * §6.5): for the lowest-indexed Active charger with a fully free window, in
 * slotIndex order. The window for a candidate charger is computed with
 * computeWindows so this never drifts from the pure, unit-tested formula in
 * windowPlan.ts. A leg's outcome anchors the next leg's travel-time cursor,
 * so slot choices and windows are resolved together, in leg order.
 */
async function resolveLegs(
  identity: string,
  legs: UnresolvedLeg[],
  departAt: number,
  assumedSpeedKmh: number,
  origin: LatLng | undefined
): Promise<{ resolved: ResolvedLeg[]; totalHold: number } | TripLegFailure> {
  const resolved: ResolvedLeg[] = [];
  let previousLocation = origin;
  let cursor = departAt;
  let totalHold = 0;

  for (let i = 0; i < legs.length; i++) {
    const leg = legs[i];

    let provider: ReserveProviderDoc;
    try {
      provider = await fetchProvider(identity, leg.providerId);
    } catch {
      return { failedLegIndex: i, providerId: leg.providerId, reason: 'provider not found' };
    }
    if (provider.status !== 'Active') {
      return { failedLegIndex: i, providerId: leg.providerId, reason: 'provider is not active' };
    }
    if (provider.approvalRequired) {
      return { failedLegIndex: i, providerId: leg.providerId, reason: 'provider requires manual approval' };
    }

    const chargers = await fetchActiveChargers(identity, leg.providerId);
    let chosen: { slotIndex: number; windowStart: number; windowEnd: number } | undefined;
    for (const charger of chargers) {
      const [window] = computeWindows(
        [{ location: leg.location, requestedEnergyWh: leg.requestedEnergyWh, ratedPowerKw: charger.ratedPowerKw }],
        cursor,
        assumedSpeedKmh,
        previousLocation
      );
      const occupied = await fetchOccupiedBuckets(identity, leg.providerId, charger.slotIndex, window.windowStart, window.windowEnd);
      if (occupied.length === 0) {
        chosen = { slotIndex: charger.slotIndex, windowStart: window.windowStart, windowEnd: window.windowEnd };
        break;
      }
    }

    if (!chosen) {
      return { failedLegIndex: i, providerId: leg.providerId, reason: 'no free slot with a registered charger in the required window' };
    }

    resolved.push({
      providerId: leg.providerId,
      slotIndex: chosen.slotIndex,
      requestedEnergyWh: leg.requestedEnergyWh,
      windowStart: chosen.windowStart,
      windowEnd: chosen.windowEnd,
    });
    totalHold += Math.floor((leg.requestedEnergyWh * provider.pricePerkWh) / 1000);

    cursor = chosen.windowEnd;
    previousLocation = leg.location;
  }

  return { resolved, totalHold };
}

/** Parses ReserveTripLegs' pipe-delimited errors (CODE|legIndex|providerId|message, §4.2) into the 409 body. */
function parseTripLegError(err: unknown): TripLegFailure | undefined {
  if (!(err instanceof GatewayError) || err.details.length === 0) return undefined;
  const message = unwrapChaincodeMessage(err.details[0].message);
  const parts = message.split('|');
  if (parts.length !== 4) return undefined;
  const [, legIndexStr, providerId, reason] = parts;
  const failedLegIndex = Number(legIndexStr);
  if (Number.isNaN(failedLegIndex)) return undefined;
  return { failedLegIndex, providerId, reason };
}

const MIN_SPEED = 20;
const MAX_SPEED = process.env.ENABLE_DEV_DEMO ? 10_000 : 150; // DEMO-HOOK
const DEFAULT_ASSUMED_SPEED_KMH = 80;

tripPlanRouter.post(
  '/trip/plan/reserve',
  asyncHandler(async (req, res) => {
    const identity = requireIdentity(req);
    const body = req.body as {
      legs?: { providerId?: string; location?: unknown; requestedEnergyWh?: number }[];
      origin?: unknown;
      departAt?: number;
      assumedSpeedKmh?: number;
      dryRun?: boolean;
    };

    if (!Array.isArray(body.legs) || body.legs.length === 0) {
      throw new HttpError(400, 'legs must be a non-empty array');
    }
    const legs: UnresolvedLeg[] = body.legs.map((leg, i) => {
      if (!leg.providerId || !leg.requestedEnergyWh || !isLatLng(leg.location)) {
        throw new HttpError(400, `legs[${i}] must have providerId, location {lat,lng}, and requestedEnergyWh`);
      }
      return { providerId: leg.providerId, location: leg.location, requestedEnergyWh: leg.requestedEnergyWh };
    });
    if (body.origin !== undefined && !isLatLng(body.origin)) {
      throw new HttpError(400, 'origin, if given, must be {lat,lng}');
    }

    const assumedSpeedKmh = body.assumedSpeedKmh ?? DEFAULT_ASSUMED_SPEED_KMH;
    if (assumedSpeedKmh < MIN_SPEED || assumedSpeedKmh > MAX_SPEED) {
      throw new HttpError(400, `assumedSpeedKmh must be between ${MIN_SPEED} and ${MAX_SPEED}`);
    }
    const departAt = body.departAt ?? Math.floor(Date.now() / 1000);

    const outcome = await resolveLegs(identity, legs, departAt, assumedSpeedKmh, body.origin);
    if ('failedLegIndex' in outcome) {
      res.status(409).json(outcome);
      return;
    }

    // §3.4: windowEnd is never sent, only windowStart -- the chaincode
    // derives windowEnd itself from requestedEnergyWh and the bound
    // charger's rated power. §7.2/7.3: providerId, slotIndex, and
    // windowStart identify where and when the driver will be, so they
    // travel as transient data (field "legs"), never as a regular argument;
    // requestedEnergyWh is public and travels as the regular argument,
    // index-aligned with the transient array.
    const publicLegsJSON = JSON.stringify(outcome.resolved.map((leg) => leg.requestedEnergyWh));
    const privateLegsJSON = JSON.stringify(
      outcome.resolved.map((leg) => ({
        providerId: leg.providerId,
        slotIndex: leg.slotIndex,
        windowStart: leg.windowStart,
      }))
    );

    let reservationIds: string[];
    try {
      // dryRun runs the exact same ReserveTripLegs validation
      // (§4.1 steps 1-10) via evaluate, so nothing commits but the preview
      // reflects real chaincode-side checks, not a gateway reimplementation
      // of them (§6.4).
      const raw = body.dryRun
        ? await withTransientContract(identity, (contract) =>
            contract.evaluate('ReserveTripLegs', {
              arguments: [publicLegsJSON],
              transientData: { legs: privateLegsJSON },
            })
          )
        : await withTransientContract(identity, (contract) =>
            contract.submit('ReserveTripLegs', {
              arguments: [publicLegsJSON],
              transientData: { legs: privateLegsJSON },
            })
          );
      reservationIds = JSON.parse(Buffer.from(raw).toString('utf8')) as string[];
    } catch (err) {
      const failure = parseTripLegError(err);
      if (failure) {
        res.status(409).json(failure);
        return;
      }
      throw err;
    }

    res.json({
      reservationIds,
      totalHold: outcome.totalHold,
      windowSource: 'deterministic' as const,
      windows: outcome.resolved.map((l) => ({
        providerId: l.providerId,
        slotIndex: l.slotIndex,
        windowStart: l.windowStart,
        windowEnd: l.windowEnd,
      })),
    });
  })
);

tripPlanRouter.post(
  '/trip/plan/cancel',
  asyncHandler(async (req, res) => {
    const identity = requireIdentity(req);
    const { reservationIds } = (req.body ?? {}) as { reservationIds?: string[] };
    if (!Array.isArray(reservationIds) || reservationIds.length === 0) {
      throw new HttpError(400, 'reservationIds must be a non-empty array');
    }

    const result = await withContract(identity, (contract) =>
      contract.submitTransaction('CancelTripLegs', JSON.stringify(reservationIds))
    );
    const refunded = JSON.parse(Buffer.from(result).toString('utf8')) as number;
    res.json({ refunded });
  })
);
