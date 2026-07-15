import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useIdentity } from '../context/IdentityContext';
import { LiveChargingTicker } from '../components/LiveChargingTicker';
import { ChargingProvider, Reservation, Session } from '../api/types';

function holdLabel(r: Reservation): string {
  if (r.escrowAmount > 0) return `${r.escrowAmount} held`;
  if (r.state === 'REQUESTED') return 'not yet locked (awaiting approval)';
  return 'settled / released';
}

export function MyReservationsPage() {
  const { identity } = useIdentity();
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [sessions, setSessions] = useState<Record<string, Session[]>>({});
  const [providers, setProviders] = useState<Record<string, ChargingProvider>>({});
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

      const providerIds = [...new Set(res.map((r) => r.providerId))];
      const missing = providerIds.filter((id) => !providers[id]);
      if (missing.length > 0) {
        const fetched = await Promise.all(missing.map((id) => api.getProvider(identity, id)));
        setProviders((prev) => ({ ...prev, ...Object.fromEntries(fetched.map((p) => [p.providerId, p])) }));
      }
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

  const handleFlagMalfunction = async (sessionId: string) => {
    const note = prompt('Describe the malfunction (for off-chain follow-up; this does not reopen settlement):');
    if (note === null) return;
    try {
      await api.flagMalfunction(identity, sessionId, note);
      alert('Malfunction flagged for off-chain review.');
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
        const provider = providers[r.providerId];
        const hold = provider ? r.requestedEnergy * provider.pricePerkWh : null;
        return (
          <div key={r.reservationId} className="card" style={{ background: '#fafafa' }}>
            <p>
              <strong>{r.reservationId}</strong> <span className={`badge ${r.state}`}>{r.state}</span>
            </p>
            <p>
              Provider: {r.providerId} · Slot {r.slotId} · Requested {r.requestedEnergy} kWh
            </p>
            <p>Hold: {holdLabel(r)}</p>
            {r.state === 'CONFIRMED' && !session && (
              <p style={{ color: '#666', fontStyle: 'italic' }}>
                Waiting for the bound charger to start the session (plug in your vehicle).
              </p>
            )}

            {session && session.state === 'Active' && (
              <LiveChargingTicker reservation={r} session={session} onStopped={load} />
            )}

            {session && session.state === 'Settled' && (
              <div>
                <p>
                  Session <strong>{session.sessionId}</strong> <span className="badge Settled">Settled</span>
                </p>
                <p>
                  Delivered {session.deliveredEnergy} kWh · Paid to provider {session.settledAmount}
                  {hold !== null && <> · Refunded {Math.max(hold - session.settledAmount, 0)}</>}
                </p>
                <button className="secondary" onClick={() => handleFlagMalfunction(session.sessionId)}>
                  Flag Malfunction
                </button>
              </div>
            )}

            <div className="row">
              {(r.state === 'REQUESTED' || r.state === 'CONFIRMED') && (
                <button className="secondary" onClick={() => handleCancel(r.reservationId)}>
                  Cancel
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
