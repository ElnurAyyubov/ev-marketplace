/**
 * DEMO_RUNNER_ADDENDUM.md section 3.1, with two additions this
 * implementation needed that the addendum's version didn't have:
 *
 * - 'reserving': each leg is reserved live, right as the car arrives,
 *   instead of the whole itinerary upfront (see the plan's "architecture
 *   resolution" -- WINDOW_BUFFER_SECONDS floors every leg-to-leg gap in one
 *   ReserveTripLegs call at ~20 real minutes, which the addendum's
 *   compression parameters don't touch and can't fix without a chaincode
 *   change). This phase is the visible moment that reservation happens.
 * - 'waiting': book-upfront mode (D5) books the whole trip before
 *   departing, so it genuinely must wait out that ~20 minute gap between
 *   legs. This phase shows an honest countdown rather than hiding it.
 */
export type DemoPhase =
  | { kind: 'idle' }
  | { kind: 'driving'; legIndex: number; progress: number } // 0..1 along the leg's path
  | { kind: 'arrived'; legIndex: number }
  | { kind: 'reserving'; legIndex: number }
  | { kind: 'waiting'; legIndex: number; opensAt: number } // unix seconds; book-upfront mode only
  | { kind: 'plugging'; legIndex: number }
  | { kind: 'charging'; legIndex: number; sessionId: string }
  | { kind: 'settled'; legIndex: number }
  | { kind: 'done' }
  | { kind: 'failed'; legIndex: number; reason: string };

export type DemoBookingMode = 'on-arrival' | 'upfront';

export interface DemoEvent {
  t: number; // ms since run start
  source: 'sim' | 'ledger';
  text: string;
  ref?: string; // sessionId / reservationId / txId
}

export interface DemoLatLng {
  lat: number;
  lng: number;
}

export interface DemoRunConfig {
  assumedSpeedKmh: number;
  requestedEnergyWhPerStop: number;
  bookingMode: DemoBookingMode;
}
