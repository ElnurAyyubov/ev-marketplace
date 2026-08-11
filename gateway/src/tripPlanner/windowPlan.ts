/**
 * Gateway-side charge-window computation (TRIP_RESERVATION_ADDENDUM.md
 * section 6.1). Proposes a windowStart for every leg of a trip; the
 * chaincode derives windowEnd itself (SmartContract.java's deriveWindowEnd,
 * mirroring section 3.4) and is the sole authority on it.
 *
 * chargeSeconds and the WINDOW_BUFFER_SECONDS addition here must never
 * understate what the chaincode would derive for the same leg, or a
 * legitimate itinerary's windowStart_{i+1} would fail to clear the previous
 * leg's chaincode-derived windowEnd_i (ReserveTripLegs validation step 3).
 * The chaincode floors chargeSeconds (integer division); this computes it as
 * a real number and only rounds (up, via Math.ceil) at the end, so the
 * result here is always >= what the chaincode independently derives. Keep
 * this in sync with SmartContract.java's deriveWindowEnd.
 */
import { LatLng } from './types';
import { roadKm } from './planner';

export const WINDOW_BUFFER_SECONDS = 1200; // must match Constants.WINDOW_BUFFER_SECONDS

export interface WindowLegInput {
  location: LatLng;
  requestedEnergyWh: number;
  ratedPowerKw: number;
}

export interface ComputedWindow {
  windowStart: number;
  windowEnd: number;
}

/**
 * origin is optional: when the caller can't supply it (e.g. no prior
 * /trip/plan call in this request), the first leg's windowStart is taken
 * directly from departAt with no travel time added.
 */
export function computeWindows(
  legs: WindowLegInput[],
  departAt: number,
  assumedSpeedKmh: number,
  origin?: LatLng
): ComputedWindow[] {
  const windows: ComputedWindow[] = [];
  let previousLocation = origin;
  let cursor = departAt; // when the driver leaves previousLocation (or departAt itself, for leg 0 with no origin)

  for (const leg of legs) {
    const travelKm = previousLocation ? roadKm(previousLocation, leg.location) : 0;
    const travelSeconds = (travelKm * 3600) / assumedSpeedKmh;
    const windowStart = Math.ceil(cursor + travelSeconds);

    const chargeSeconds = (leg.requestedEnergyWh * 3600) / (leg.ratedPowerKw * 1000);
    const windowEnd = Math.ceil(windowStart + chargeSeconds + WINDOW_BUFFER_SECONDS);

    windows.push({ windowStart, windowEnd });
    cursor = windowEnd;
    previousLocation = leg.location;
  }

  return windows;
}
