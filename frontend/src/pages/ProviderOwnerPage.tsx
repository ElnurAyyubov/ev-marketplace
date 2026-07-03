import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useIdentity } from '../context/IdentityContext';
import { ChargingProvider, Reservation, Session } from '../api/types';

export function ProviderOwnerPage() {
  const { identity } = useIdentity();
  const [providers, setProviders] = useState<ChargingProvider[]>([]);
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [sessions, setSessions] = useState<Record<string, Session[]>>({});
  const [deliveredEnergyInputs, setDeliveredEnergyInputs] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);

  const loadProviders = async () => {
    const results = await api.queryProviders(identity, { ownerId: identity });
    setProviders(results);
    if (!selectedProviderId && results.length > 0) {
      setSelectedProviderId(results[0].providerId);
    }
  };

  const loadReservations = async (providerId: string) => {
    setError(null);
    try {
      const res = await api.listReservationsByProvider(identity, providerId);
      setReservations(res);
      const sessionEntries = await Promise.all(
        res.map(
          async (r) =>
            [r.reservationId, await api.listSessionsByReservation(identity, r.reservationId)] as const
        )
      );
      setSessions(Object.fromEntries(sessionEntries));
    } catch (err) {
      setError((err as Error).message);
    }
  };

  useEffect(() => {
    loadProviders();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity]);

  useEffect(() => {
    if (selectedProviderId) loadReservations(selectedProviderId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProviderId]);

  const handleApprove = async (reservationId: string) => {
    try {
      await api.approveReservation(identity, reservationId);
      if (selectedProviderId) loadReservations(selectedProviderId);
    } catch (err) {
      alert((err as Error).message);
    }
  };

  const handleReject = async (reservationId: string) => {
    try {
      await api.cancelReservation(identity, reservationId);
      if (selectedProviderId) loadReservations(selectedProviderId);
    } catch (err) {
      alert((err as Error).message);
    }
  };

  const handleStartSession = async (reservationId: string) => {
    try {
      await api.startSession(identity, reservationId);
      if (selectedProviderId) loadReservations(selectedProviderId);
    } catch (err) {
      alert((err as Error).message);
    }
  };

  const handleComplete = async (sessionId: string) => {
    const delivered = deliveredEnergyInputs[sessionId] ?? 0;
    try {
      await api.completeSession(identity, sessionId, delivered);
      if (selectedProviderId) loadReservations(selectedProviderId);
    } catch (err) {
      alert((err as Error).message);
    }
  };

  return (
    <div className="card">
      <h2>Provider Owner View ({identity})</h2>
      {providers.length === 0 && <p>You don't own any providers yet.</p>}
      {providers.length > 0 && (
        <div className="field">
          <label>Your provider</label>
          <select
            value={selectedProviderId ?? ''}
            onChange={(e) => setSelectedProviderId(e.target.value)}
          >
            {providers.map((p) => (
              <option key={p.providerId} value={p.providerId}>
                {p.locationLabel} ({p.providerType})
              </option>
            ))}
          </select>
        </div>
      )}

      {error && <p className="error">{error}</p>}

      {reservations.map((r) => {
        const session = sessions[r.reservationId]?.[0];
        return (
          <div key={r.reservationId} className="card" style={{ background: '#fafafa' }}>
            <p>
              <strong>{r.reservationId}</strong> <span className={`badge ${r.state}`}>{r.state}</span>
            </p>
            <p>
              Driver: {r.driverId} · Slot {r.slotId} · Requested {r.requestedEnergy} kWh · Escrow{' '}
              {r.escrowAmount}
            </p>

            <div className="row">
              {r.state === 'REQUESTED' && (
                <>
                  <button onClick={() => handleApprove(r.reservationId)}>Approve</button>
                  <button className="secondary" onClick={() => handleReject(r.reservationId)}>
                    Reject
                  </button>
                </>
              )}
              {r.state === 'CONFIRMED' && !session && (
                <button onClick={() => handleStartSession(r.reservationId)}>Start Session</button>
              )}
            </div>

            {session && (
              <div style={{ marginTop: 8 }}>
                <p>
                  Session <strong>{session.sessionId}</strong>{' '}
                  <span className={`badge ${session.state}`}>{session.state}</span>
                </p>
                {session.state === 'Active' && (
                  <div className="row">
                    <input
                      type="number"
                      placeholder="Delivered energy (kWh)"
                      value={deliveredEnergyInputs[session.sessionId] ?? ''}
                      onChange={(e) =>
                        setDeliveredEnergyInputs((prev) => ({
                          ...prev,
                          [session.sessionId]: Number(e.target.value),
                        }))
                      }
                    />
                    <button onClick={() => handleComplete(session.sessionId)}>Complete Session</button>
                  </div>
                )}
                {session.state !== 'Active' && (
                  <p>
                    Delivered {session.deliveredEnergy} kWh, settled {session.settledAmount}
                  </p>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
