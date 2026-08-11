/**
 * Demo runner state machine (DEMO_RUNNER_ADDENDUM.md section 3). Drives the
 * whole reserve -> plug -> charge -> settle loop live at each stop.
 *
 * Two booking modes (section 8, D5):
 *
 * - 'on-arrival' (default): each leg is reserved live, via a single-leg
 *   call to the real /trip/plan/reserve -> ReserveTripLegs endpoint, right
 *   as the car arrives -- rather than the whole itinerary in one call
 *   upfront. This is a deliberate deviation from the addendum's original
 *   single-mode design: WINDOW_BUFFER_SECONDS (a fixed 1200s,
 *   chaincode/marketplace/src/main/java/marketplace/Constants.java) floors
 *   every leg-to-leg gap in one ReserveTripLegs call at ~20 real minutes,
 *   regardless of assumedSpeedKmh/ratedPowerKw, which the addendum's own
 *   compression parameters never touch and can't fix without a chaincode
 *   change (out of scope, section 2.4/10). Booking one leg at a time keeps
 *   this mode fast and every reservation fully real.
 * - 'upfront': the whole itinerary is reserved atomically before departing
 *   (the R2/R4 headline feature), then each leg's charger-plug attempt
 *   genuinely waits for that leg's reservation window to open -- shown as
 *   a real 'waiting' phase, not hidden. This mode is slow for multi-stop
 *   trips (the same ~20 real minutes per leg WINDOW_BUFFER_SECONDS floors),
 *   which is the honest trade this mode makes to demonstrate the
 *   whole-itinerary-booked-before-departure property.
 */
import { useCallback, useRef, useState } from 'react';
import { api } from '../api/client';
import { Identity, LatLng, TripPlan } from '../api/types';
import { useIdentity } from '../context/IdentityContext';
import { demoApi } from './api';
import { DemoEvent, DemoLatLng, DemoPhase, DemoRunConfig } from './types';

const EARTH_RADIUS_KM = 6371;
const DETOUR = 1.3; // mirrors gateway/src/tripPlanner/planner.ts's roadKm (TRIP_RESERVATION_ADDENDUM.md section 6.1)
const SESSION_POLL_MS = 1500;
const WINDOW_POLL_MS = 2000; // upfront mode's wait-for-window retry cadence
const STALL_TIMEOUT_MS = 45_000; // D4 acceptance: killing a charger-sim mid-run must fail cleanly, not hang.
// Matches SmartContract.java's StartSession rejection text exactly
// ("reservation " + id + " cannot start before its window (starts at " + ... + ")").
const WINDOW_NOT_OPEN_MARKER = 'cannot start before its window';

function haversineKm(a: LatLng, b: LatLng): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

/** Origin, each planned stop, destination, in order -- same list TripPlanMap's straight-line fallback uses. */
function waypointsOf(plan: TripPlan): LatLng[] {
  return [plan.origin, ...plan.stops.map((s) => s.location), plan.destination];
}

/**
 * roadGeometry (gateway/src/tripPlanner/roadOverlay.ts) is one OSRM route
 * across every waypoint with no per-leg boundary markers, so this finds the
 * geometry point nearest each waypoint and slices between them. Falls back
 * to a straight two-point path per leg when there's no road overlay.
 */
function legPaths(plan: TripPlan): LatLng[][] {
  const waypoints = waypointsOf(plan);
  const geometry = plan.roadGeometry;
  if (!geometry || geometry.length < 2) {
    const paths: LatLng[][] = [];
    for (let i = 0; i < waypoints.length - 1; i++) paths.push([waypoints[i], waypoints[i + 1]]);
    return paths;
  }

  const nearestIndex = (point: LatLng, fromIndex: number): number => {
    let best = fromIndex;
    let bestDist = Infinity;
    for (let i = fromIndex; i < geometry.length; i++) {
      const d = haversineKm(point, geometry[i]);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    return best;
  };

  const boundaries = [0];
  let cursor = 0;
  for (let i = 1; i < waypoints.length; i++) {
    cursor = nearestIndex(waypoints[i], cursor);
    boundaries.push(cursor);
  }
  boundaries[boundaries.length - 1] = geometry.length - 1;

  const paths: LatLng[][] = [];
  for (let i = 0; i < boundaries.length - 1; i++) {
    const start = boundaries[i];
    const end = Math.max(boundaries[i + 1], start + 1);
    paths.push(geometry.slice(start, end + 1));
  }
  return paths;
}

function pathLengthKm(path: LatLng[]): number {
  let total = 0;
  for (let i = 1; i < path.length; i++) total += haversineKm(path[i - 1], path[i]);
  return total;
}

/** Position at `progress` (0..1) along a multi-point path, walked by cumulative distance. */
function positionAlongPath(path: LatLng[], progress: number): DemoLatLng {
  if (path.length === 1) return path[0];
  const clamped = Math.max(0, Math.min(1, progress));
  const total = pathLengthKm(path);
  if (total === 0) return path[path.length - 1];

  const target = total * clamped;
  let covered = 0;
  for (let i = 1; i < path.length; i++) {
    const segKm = haversineKm(path[i - 1], path[i]);
    if (covered + segKm >= target || i === path.length - 1) {
      const t = segKm === 0 ? 1 : Math.max(0, Math.min(1, (target - covered) / segKm));
      return {
        lat: path[i - 1].lat + (path[i].lat - path[i - 1].lat) * t,
        lng: path[i - 1].lng + (path[i].lng - path[i - 1].lng) * t,
      };
    }
    covered += segKm;
  }
  return path[path.length - 1];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface ReservedLeg {
  reservationId: string;
  providerId: string;
  slotIndex: number;
  windowStart: number;
  totalHold: number;
}

export interface UseDemoRunnerResult {
  phase: DemoPhase;
  carPosition: DemoLatLng | null;
  events: DemoEvent[];
  running: boolean;
  start: (config: DemoRunConfig) => void;
  stop: () => void;
  /** D5: books a bucket out from under `stopIndex` as a second driver identity. No-op unless a run is active. */
  injectConflictAtStop: (stopIndex: number) => void;
}

export function useDemoRunner(plan: TripPlan | null): UseDemoRunnerResult {
  const { identity } = useIdentity();
  const [phase, setPhase] = useState<DemoPhase>({ kind: 'idle' });
  const [carPosition, setCarPosition] = useState<DemoLatLng | null>(null);
  const [events, setEvents] = useState<DemoEvent[]>([]);
  const [running, setRunning] = useState(false);
  const rafRef = useRef<number | null>(null);
  // A generation counter rather than a shared cancelled boolean: stop()
  // and start() both bump it, so a stale in-flight run (still resolving a
  // pending fetch when the user stops and immediately restarts) can tell
  // it's no longer current even after a new run has reset a plain boolean
  // out from under it.
  const generationRef = useRef(0);
  const runStartRef = useRef(0);
  const activeChargerIdRef = useRef<string | null>(null);
  const reservedLegsRef = useRef<ReservedLeg[] | null>(null); // set once, upfront mode only
  const activeConfigRef = useRef<DemoRunConfig | null>(null);

  const pushEvent = useCallback((source: DemoEvent['source'], text: string, ref?: string) => {
    setEvents((prev) => [...prev, { t: Date.now() - runStartRef.current, source, text, ref }]);
  }, []);

  const stop = useCallback(() => {
    generationRef.current++;
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    if (activeChargerIdRef.current) {
      // Best-effort cleanup so a manual stop mid-charge doesn't leave a
      // charger-sim actively ticking against an abandoned run.
      void demoApi.unplug(identity, { chargerId: activeChargerIdRef.current }).catch(() => {});
      activeChargerIdRef.current = null;
    }
    reservedLegsRef.current = null;
    setRunning(false);
    setPhase({ kind: 'idle' });
    setCarPosition(null);
  }, [identity]);

  const driveLeg = useCallback(
    (legIndex: number, path: LatLng[], travelSeconds: number, myGeneration: number): Promise<void> => {
      return new Promise((resolve) => {
        const startedAt = performance.now();
        const durationMs = Math.max(travelSeconds * 1000, 1);
        const tick = (now: number) => {
          if (generationRef.current !== myGeneration) {
            resolve();
            return;
          }
          const progress = Math.min(1, (now - startedAt) / durationMs);
          setPhase({ kind: 'driving', legIndex, progress });
          setCarPosition(positionAlongPath(path, progress));
          if (progress >= 1) {
            resolve();
            return;
          }
          rafRef.current = requestAnimationFrame(tick);
        };
        rafRef.current = requestAnimationFrame(tick);
      });
    },
    []
  );

  /** Shared tail once a charger is plugged in: wait for the session to appear, then poll readings until Settled. */
  const chargeAndSettle = useCallback(
    async (
      legIndex: number,
      id: Identity,
      chargerId: string,
      reservationId: string,
      totalHold: number,
      myGeneration: number
    ): Promise<boolean> => {
      let sessionId: string | undefined;
      let waitedMs = 0;
      while (!sessionId) {
        if (generationRef.current !== myGeneration) return false;
        const sessions = await api.listSessionsByReservation(id, reservationId);
        if (sessions.length > 0) {
          sessionId = sessions[sessions.length - 1].sessionId;
          break;
        }
        if (waitedMs >= STALL_TIMEOUT_MS) {
          activeChargerIdRef.current = null;
          setPhase({ kind: 'failed', legIndex, reason: 'charger-sim never started a session -- is it still running?' });
          return false;
        }
        await sleep(SESSION_POLL_MS);
        waitedMs += SESSION_POLL_MS;
      }

      pushEvent('ledger', `StartSession committed -- session ${sessionId}, charger ${chargerId}`, sessionId);
      setPhase({ kind: 'charging', legIndex, sessionId });

      let lastSeq = 0;
      let lastProgressAt = Date.now();
      for (;;) {
        if (generationRef.current !== myGeneration) return false;
        await sleep(SESSION_POLL_MS);

        const [session, readings] = await Promise.all([
          api.getSession(id, sessionId),
          api.getSessionReadings(id, sessionId),
        ]);
        const latest = readings[readings.length - 1];
        if (latest && latest.seq > lastSeq) {
          lastSeq = latest.seq;
          lastProgressAt = Date.now();
          pushEvent('ledger', `Reading #${latest.seq} -- ${latest.cumulativeWh.toLocaleString()} Wh cumulative`, sessionId);
        }

        if (session.state === 'Settled') {
          const refunded = totalHold - session.settledAmount;
          pushEvent('ledger', `StopSession -- provider paid ${session.settledAmount}, driver refunded ${refunded}`, sessionId);
          activeChargerIdRef.current = null;
          setPhase({ kind: 'settled', legIndex });
          return true;
        }

        if (Date.now() - lastProgressAt > STALL_TIMEOUT_MS) {
          activeChargerIdRef.current = null;
          setPhase({ kind: 'failed', legIndex, reason: 'no meter readings for too long -- has the charger-sim died?' });
          return false;
        }
      }
    },
    [pushEvent]
  );

  /**
   * Plugs in. In on-arrival mode (`opensAt` undefined) this is a single
   * attempt -- any failure is real. In upfront mode (`opensAt` given) a
   * "cannot start before its window" rejection is expected and retried
   * until the reservation's real window opens (TRIP_RESERVATION_ADDENDUM.md
   * section 9's StartSession check) -- the 'waiting' phase makes that real
   * wait visible instead of hiding it.
   */
  const plugIn = useCallback(
    async (
      legIndex: number,
      id: Identity,
      chargerId: string,
      reservationId: string,
      myGeneration: number,
      opensAt?: number
    ): Promise<boolean> => {
      activeChargerIdRef.current = chargerId;
      setPhase(opensAt !== undefined ? { kind: 'waiting', legIndex, opensAt } : { kind: 'plugging', legIndex });
      for (;;) {
        if (generationRef.current !== myGeneration) return false;
        try {
          await demoApi.plugin(id, { chargerId, reservationId });
          pushEvent('sim', `Plugging in at ${chargerId}`);
          return true;
        } catch (err) {
          const message = (err as Error).message;
          if (opensAt === undefined || !message.includes(WINDOW_NOT_OPEN_MARKER)) {
            activeChargerIdRef.current = null;
            setPhase({ kind: 'failed', legIndex, reason: message });
            return false;
          }
          await sleep(WINDOW_POLL_MS);
        }
      }
    },
    [pushEvent]
  );

  /** On-arrival mode (default): reserve this one leg live, right as the car arrives. */
  const runStopOnArrival = useCallback(
    async (legIndex: number, id: Identity, requestedEnergyWh: number, myGeneration: number): Promise<boolean> => {
      const stopPlan = plan!.stops[legIndex];
      setPhase({ kind: 'reserving', legIndex });

      let reserveResult;
      try {
        reserveResult = await api.reserveTrip(id, {
          legs: [{ providerId: stopPlan.providerId, location: stopPlan.location, requestedEnergyWh }],
          origin: stopPlan.location, // the car already arrived here -- zero travel time from "origin" to this leg
          dryRun: false,
        });
      } catch (err) {
        setPhase({ kind: 'failed', legIndex, reason: (err as Error).message });
        return false;
      }
      if (generationRef.current !== myGeneration) return false;

      const reservationId = reserveResult.reservationIds[0];
      const window = reserveResult.windows[0];
      pushEvent(
        'ledger',
        `ReserveTripLegs committed -- reservation ${reservationId} at ${stopPlan.providerType} provider, slot ${window.slotIndex}`,
        reservationId
      );

      const chargers = await api.listChargersByProvider(id, stopPlan.providerId);
      if (generationRef.current !== myGeneration) return false;
      const charger = chargers.find((c) => c.slotIndex === window.slotIndex);
      if (!charger) {
        setPhase({ kind: 'failed', legIndex, reason: `no charger bound to slot ${window.slotIndex}` });
        return false;
      }

      const plugged = await plugIn(legIndex, id, charger.chargerId, reservationId, myGeneration);
      if (!plugged) return false;
      return chargeAndSettle(legIndex, id, charger.chargerId, reservationId, reserveResult.totalHold, myGeneration);
    },
    [plan, pushEvent, plugIn, chargeAndSettle]
  );

  /** Upfront mode: this leg was already reserved before departure -- just wait for its window and plug in. */
  const runStopUpfront = useCallback(
    async (legIndex: number, id: Identity, myGeneration: number): Promise<boolean> => {
      const reserved = reservedLegsRef.current?.[legIndex];
      if (!reserved) {
        setPhase({ kind: 'failed', legIndex, reason: 'no upfront reservation found for this leg' });
        return false;
      }
      const stopPlan = plan!.stops[legIndex];
      const chargers = await api.listChargersByProvider(id, stopPlan.providerId);
      if (generationRef.current !== myGeneration) return false;
      const charger = chargers.find((c) => c.slotIndex === reserved.slotIndex);
      if (!charger) {
        setPhase({ kind: 'failed', legIndex, reason: `no charger bound to slot ${reserved.slotIndex}` });
        return false;
      }

      const plugged = await plugIn(legIndex, id, charger.chargerId, reserved.reservationId, myGeneration, reserved.windowStart);
      if (!plugged) return false;
      return chargeAndSettle(legIndex, id, charger.chargerId, reserved.reservationId, reserved.totalHold, myGeneration);
    },
    [plan, plugIn, chargeAndSettle]
  );

  /** Upfront mode's first step: reserve the whole itinerary atomically before departing (section 8, "book upfront"). */
  const reserveAllUpfront = useCallback(
    async (id: Identity, config: DemoRunConfig, myGeneration: number): Promise<boolean> => {
      if (!plan) return false;
      setPhase({ kind: 'reserving', legIndex: 0 });
      const legs = plan.stops.map((s) => ({
        providerId: s.providerId,
        location: s.location,
        requestedEnergyWh: config.requestedEnergyWhPerStop,
      }));

      let result;
      try {
        result = await api.reserveTrip(id, {
          legs,
          origin: plan.origin,
          departAt: Math.floor(Date.now() / 1000),
          assumedSpeedKmh: config.assumedSpeedKmh,
          dryRun: false,
        });
      } catch (err) {
        setPhase({ kind: 'failed', legIndex: 0, reason: (err as Error).message });
        return false;
      }
      if (generationRef.current !== myGeneration) return false;

      pushEvent(
        'ledger',
        `ReserveTripLegs committed -- ${result.reservationIds.length} reservations booked upfront, total hold ${result.totalHold}`,
        result.reservationIds.join(',')
      );
      // Per-leg escrow isn't in the response (only the trip total is), so
      // it's recomputed with the same integer formula ReserveTripLegs uses
      // (requestedEnergyWh * pricePerkWh / 1000) for chargeAndSettle's
      // refund line.
      reservedLegsRef.current = result.windows.map((w, i) => ({
        reservationId: result.reservationIds[i],
        providerId: w.providerId,
        slotIndex: w.slotIndex,
        windowStart: w.windowStart,
        totalHold: Math.floor((config.requestedEnergyWhPerStop * plan.stops[i].pricePerkWh) / 1000),
      }));
      return true;
    },
    [plan, pushEvent]
  );

  /**
   * One path per leg, legs.length === plan.stops.length + 1: paths[0..stops.length-1]
   * drive to each chargeable stop (reserve/plug/charge/settle happens on
   * arrival), the final path drives from the last stop to the destination
   * with no charging.
   */
  const runLegs = useCallback(
    async (config: DemoRunConfig, myGeneration: number) => {
      if (!plan || plan.status !== 'feasible') return;
      runStartRef.current = Date.now();
      setEvents([]);
      reservedLegsRef.current = null;
      pushEvent(
        'sim',
        `Departing ${plan.origin.label ?? 'origin'} -> ${plan.destination.label ?? 'destination'}, ${plan.stops.length} stop${
          plan.stops.length === 1 ? '' : 's'
        } planned, booking ${config.bookingMode === 'upfront' ? 'the whole trip upfront' : 'each stop on arrival'}`
      );

      // try/finally so every exit path -- normal completion, user cancel,
      // or a genuine failure -- always clears `running`. An early `return`
      // on failure without this left the control bar stuck showing "Stop"
      // with phase 'failed' and nothing actually running.
      try {
        if (config.bookingMode === 'upfront') {
          const ok = await reserveAllUpfront(identity, config, myGeneration);
          if (generationRef.current !== myGeneration || !ok) return;
        }

        const hasRoadOverlay = Boolean(plan.roadGeometry && plan.roadGeometry.length >= 2);
        const paths = legPaths(plan);

        for (let i = 0; i < paths.length; i++) {
          if (generationRef.current !== myGeneration) return;
          const path = paths[i];
          // Road-overlay paths already reflect real curvature; straight
          // fallback legs apply the same DETOUR factor the gateway's own
          // roadKm does, so pacing is consistent either way.
          const km = pathLengthKm(path) * (hasRoadOverlay ? 1 : DETOUR);
          const travelSeconds = (km * 3600) / config.assumedSpeedKmh;
          await driveLeg(i, path, travelSeconds, myGeneration);
          if (generationRef.current !== myGeneration) return;
          setPhase({ kind: 'arrived', legIndex: i });

          if (i < plan.stops.length) {
            pushEvent('sim', `Arrived ${plan.stops[i].providerId} (leg ${i + 1})`);
            const ok =
              config.bookingMode === 'upfront'
                ? await runStopUpfront(i, identity, myGeneration)
                : await runStopOnArrival(i, identity, config.requestedEnergyWhPerStop, myGeneration);
            if (generationRef.current !== myGeneration || !ok) return;
            const next = i + 1 < plan.stops.length ? plan.stops[i + 1].providerId : plan.destination.label ?? 'destination';
            pushEvent('sim', `Departing ${plan.stops[i].providerId} -> ${next}`);
          }
        }
        if (generationRef.current === myGeneration) setPhase({ kind: 'done' });
      } finally {
        // Guarded: a stale run (superseded by a newer start()) resolving
        // late must not clear `running` out from under the run that
        // superseded it.
        if (generationRef.current === myGeneration) setRunning(false);
      }
    },
    [plan, driveLeg, runStopOnArrival, runStopUpfront, reserveAllUpfront, pushEvent, identity]
  );

  const start = useCallback(
    (config: DemoRunConfig) => {
      if (!plan || plan.status !== 'feasible' || running) return;
      const myGeneration = ++generationRef.current;
      activeConfigRef.current = config;
      setRunning(true);
      void runLegs(config, myGeneration);
    },
    [plan, running, runLegs]
  );

  /**
   * D5: books a bucket out from under `stopIndex` as a second driver
   * identity (POST /dev/demo/conflict), exercising the real
   * TRIP_LEG_CONFLICT / 409 path (TRIP_RESERVATION_ADDENDUM.md section 10)
   * rather than a fake one. In upfront mode the real reservation already
   * exists by the time this is clicked, so the injection itself is what
   * fails -- which is the demonstration: pre-reservation blocks the
   * competitor, not the other way around (section 8's closing argument).
   */
  const injectConflictAtStop = useCallback(
    (stopIndex: number) => {
      if (!plan || !running || stopIndex < 0 || stopIndex >= plan.stops.length) return;
      void (async () => {
        const stopPlan = plan.stops[stopIndex];
        const reserved = reservedLegsRef.current?.[stopIndex];
        let providerId: string;
        let slotIndex: number;
        let windowStart: number;

        if (reserved) {
          ({ providerId, slotIndex, windowStart } = reserved);
        } else {
          // On-arrival mode: this leg isn't reserved yet. A dryRun preview
          // through the same real endpoint the live reservation will use
          // learns which slot/window it would land in, without committing
          // anything.
          try {
            const requestedEnergyWh = activeConfigRef.current?.requestedEnergyWhPerStop ?? 20_000;
            const preview = await api.reserveTrip(identity, {
              legs: [{ providerId: stopPlan.providerId, location: stopPlan.location, requestedEnergyWh }],
              origin: stopPlan.location,
              dryRun: true,
            });
            providerId = preview.windows[0].providerId;
            slotIndex = preview.windows[0].slotIndex;
            windowStart = preview.windows[0].windowStart;
          } catch (err) {
            pushEvent('sim', `Conflict injection preview failed: ${(err as Error).message}`);
            return;
          }
        }

        try {
          await demoApi.conflict(identity, { providerId, slotIndex, windowStart });
          pushEvent('sim', `Conflict injected at stop ${stopIndex + 1} (as demo-driver-2) -- claims the same booking bucket`);
        } catch (err) {
          pushEvent(
            'sim',
            `Conflict injection at stop ${stopIndex + 1} failed: ${(err as Error).message} -- the real booking already holds this slot`
          );
        }
      })();
    },
    [plan, running, identity, pushEvent]
  );

  return { phase, carPosition, events, running, start, stop, injectConflictAtStop };
}
