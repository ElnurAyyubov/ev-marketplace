import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useIdentity } from '../context/IdentityContext';
import { Reservation, Session } from '../api/types';

function escrowLabel(r: Reservation): string {
  if (r.escrowAmount > 0) return `${r.escrowAmount} held`;
  if (r.state === 'REQUESTED') return 'not yet locked (awaiting approval)';
  return 'settled / released';
}

export function MyReservationsPage() {
  const { identity } = useIdentity();
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [sessions, setSessions] = useState<Record<string, Session[]>>({});
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setError(null);
    try {
      const res = await api.listReservationsByDriver(identity, identity);
      setReservations(res);
      const sessionEntries = await Promise.all(
        res.map(async (r) => [r.reservationId, await api.listSessionsByReservation(identity, r.reservationId)] as const)
      );
      setSessions(Object.fromEntries(sessionEntries));
    } catch (err) {
      setError((err as Error).message);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity]);

  const handleCancel = async (reservationId: string) => {
    try {
      await api.cancelReservation(identity, reservationId);
      load();
    } catch (err) {
      alert((err as Error).message);
    }
  };

  const handleStartSession = async (reservationId: string) => {
    try {
      await api.startSession(identity, reservationId);
      load();
    } catch (err) {
      alert((err as Error).message);
    }
  };

  const handleDispute = async (sessionId: string) => {
    try {
      await api.disputeSession(identity, sessionId);
      load();
    } catch (err) {
      alert((err as Error).message);
    }
  };

  return (
    <div className="card">
      <h2>My Reservations ({identity})</h2>
      {error && <p className="error">{error}</p>}
      {reservations.length === 0 && <p>No reservations yet.</p>}
      {reservations.map((r) => {
        const session = sessions[r.reservationId]?.[0];
        return (
          <div key={r.reservationId} className="card" style={{ background: '#fafafa' }}>
            <p>
              <strong>{r.reservationId}</strong> <span className={`badge ${r.state}`}>{r.state}</span>
            </p>
            <p>
              Provider: {r.providerId} · Slot {r.slotId} · Requested {r.requestedEnergy} kWh
            </p>
            <p>Escrow: {escrowLabel(r)}</p>
            {session && (
              <p>
                Session <strong>{session.sessionId}</strong>{' '}
                <span className={`badge ${session.state}`}>{session.state}</span>
                {session.state !== 'Active' && (
                  <> — delivered {session.deliveredEnergy} kWh, paid to provider {session.settledAmount}</>
                )}
              </p>
            )}
            <div className="row">
              {(r.state === 'REQUESTED' || r.state === 'CONFIRMED') && (
                <button className="secondary" onClick={() => handleCancel(r.reservationId)}>
                  Cancel
                </button>
              )}
              {r.state === 'CONFIRMED' && !session && (
                <button onClick={() => handleStartSession(r.reservationId)}>Start Session</button>
              )}
              {session && (session.state === 'Active' || session.state === 'Completed') && (
                <button className="secondary" onClick={() => handleDispute(session.sessionId)}>
                  Dispute Session
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
