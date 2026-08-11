/**
 * Demo runner state machine (DEMO_RUNNER_ADDENDUM.md section 3). This first
 * pass covers D3 only: drive/arrive animation along the planned route, zero
 * network calls. The reserve/plug/charge/settle loop (D4) extends the
 * per-leg body of `runLegs` below in a later change.
 */
import { useCallback, useRef, useState } from 'react';
import { LatLng, TripPlan } from '../api/types';
import { DemoLatLng, DemoPhase } from './types';

const EARTH_RADIUS_KM = 6371;
const DETOUR = 1.3; // mirrors gateway/src/tripPlanner/planner.ts's roadKm (TRIP_RESERVATION_ADDENDUM.md section 6.1)

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

export interface UseDemoRunnerResult {
  phase: DemoPhase;
  carPosition: DemoLatLng | null;
  running: boolean;
  start: (assumedSpeedKmh: number) => void;
  stop: () => void;
}

export function useDemoRunner(plan: TripPlan | null): UseDemoRunnerResult {
  const [phase, setPhase] = useState<DemoPhase>({ kind: 'idle' });
  const [carPosition, setCarPosition] = useState<DemoLatLng | null>(null);
  const [running, setRunning] = useState(false);
  const rafRef = useRef<number | null>(null);
  const cancelledRef = useRef(false);

  const stop = useCallback(() => {
    cancelledRef.current = true;
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    setRunning(false);
    setPhase({ kind: 'idle' });
    setCarPosition(null);
  }, []);

  const driveLeg = useCallback((legIndex: number, path: LatLng[], travelSeconds: number): Promise<void> => {
    return new Promise((resolve) => {
      const startedAt = performance.now();
      const durationMs = Math.max(travelSeconds * 1000, 1);
      const tick = (now: number) => {
        if (cancelledRef.current) {
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
  }, []);

  /**
   * One path per leg, legs.length === plan.stops.length + 1: paths[0..stops.length-1]
   * drive to each chargeable stop, the final path drives from the last stop to the
   * destination (no charging there). D4 fills in the reserve/plug/charge/settle
   * body for i < plan.stops.length between drive and the next leg's drive.
   */
  const runLegs = useCallback(
    async (assumedSpeedKmh: number) => {
      if (!plan || plan.status !== 'feasible') return;
      const hasRoadOverlay = Boolean(plan.roadGeometry && plan.roadGeometry.length >= 2);
      const paths = legPaths(plan);

      for (let i = 0; i < paths.length; i++) {
        if (cancelledRef.current) return;
        const path = paths[i];
        // Road-overlay paths already reflect real curvature; straight
        // fallback legs apply the same DETOUR factor the gateway's own
        // roadKm does, so pacing is consistent either way.
        const km = pathLengthKm(path) * (hasRoadOverlay ? 1 : DETOUR);
        const travelSeconds = (km * 3600) / assumedSpeedKmh;
        await driveLeg(i, path, travelSeconds);
        if (cancelledRef.current) return;
        setPhase({ kind: 'arrived', legIndex: i });
      }
      if (!cancelledRef.current) setPhase({ kind: 'done' });
      setRunning(false);
    },
    [plan, driveLeg]
  );

  const start = useCallback(
    (assumedSpeedKmh: number) => {
      if (!plan || plan.status !== 'feasible' || running) return;
      cancelledRef.current = false;
      setRunning(true);
      void runLegs(assumedSpeedKmh);
    },
    [plan, running, runLegs]
  );

  return { phase, carPosition, running, start, stop };
}
