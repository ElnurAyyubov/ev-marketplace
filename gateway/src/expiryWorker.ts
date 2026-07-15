import { withContract } from './fabric';

interface ReservationRecord {
  reservationId: string;
  state: string;
  expiresAt: number;
}

const POLL_INTERVAL_MS = 30_000;
const SWEEP_STATES = ['REQUESTED', 'CONFIRMED'] as const;

async function sweepExpiredReservations(): Promise<void> {
  const nowSeconds = Math.floor(Date.now() / 1000);

  for (const state of SWEEP_STATES) {
    const result = await withContract('admin', (contract) =>
      contract.evaluateTransaction('QueryReservationsByState', state)
    );
    const reservations = JSON.parse(Buffer.from(result).toString('utf8')) as ReservationRecord[];

    for (const reservation of reservations) {
      if (reservation.expiresAt >= nowSeconds) continue;
      try {
        await withContract('admin', (contract) =>
          contract.submitTransaction('ExpireReservation', reservation.reservationId)
        );
      } catch (err) {
        console.error(`failed to expire reservation ${reservation.reservationId}:`, err);
      }
    }
  }
}

/** Periodically expires REQUESTED/CONFIRMED reservations past their expiresAt deadline (e.g. a driver never started the session). */
export function startReservationExpiryWorker(): void {
  setInterval(() => {
    sweepExpiredReservations().catch((err) => console.error('reservation expiry sweep failed:', err));
  }, POLL_INTERVAL_MS);
}
