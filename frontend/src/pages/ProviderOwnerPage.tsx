import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useIdentity } from '../context/IdentityContext';
import { Charger, ChargingProvider, Reservation, Session, Slot } from '../api/types';

export function ProviderOwnerPage() {
  const { identity } = useIdentity();
  const [providers, setProviders] = useState<ChargingProvider[]>([]);
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [chargers, setChargers] = useState<Charger[]>([]);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [sessions, setSessions] = useState<Record<string, Session[]>>({});
  const [error, setError] = useState<string | null>(null);

  const [chargerSlotIndex, setChargerSlotIndex] = useState<number | null>(null);
  const [chargerId, setChargerId] = useState('charger1');
  const [ratedPowerKw, setRatedPowerKw] = useState(22);
  const [registerBusy, setRegisterBusy] = useState(false);
  const [registerError, setRegisterError] = useState<string | null>(null);

  const loadProviders = async () => {
    const results = await api.queryProviders(identity, { ownerId: identity });
    setProviders(results);
    if (!selectedProviderId && results.length > 0) {
      setSelectedProviderId(results[0].providerId);
    }
  };

  const loadChargerData = async (providerId: string) => {
    const [s, c] = await Promise.all([
      api.getSlots(identity, providerId),
      api.listChargersByProvider(identity, providerId),
    ]);
    setSlots(s);
    setChargers(c);
    const unbound = s.find((slot) => !c.some((ch) => ch.slotIndex === Number(slot.slotId)));
    setChargerSlotIndex(unbound ? Number(unbound.slotId) : null);
  };

  const selectedProvider = providers.find((p) => p.providerId === selectedProviderId) ?? null;

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
    if (selectedProviderId) {
      loadReservations(selectedProviderId);
      loadChargerData(selectedProviderId);
    }
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

  const handleToggleStatus = async () => {
    if (!selectedProviderId || !selectedProvider) return;
    const nextStatus = selectedProvider.status === 'Active' ? 'Inactive' : 'Active';
    try {
      await api.updateProviderStatus(identity, selectedProviderId, nextStatus);
      await loadProviders();
    } catch (err) {
      alert((err as Error).message);
    }
  };

  const handleDelete = async () => {
    if (!selectedProviderId) return;
    if (!window.confirm('Permanently delete this station? This cannot be undone.')) return;
    try {
      await api.deleteProvider(identity, selectedProviderId);
      await loadProviders();
    } catch (err) {
      alert((err as Error).message);
    }
  };

  const handleRegisterCharger = async () => {
    if (!selectedProviderId || chargerSlotIndex === null) return;
    setRegisterBusy(true);
    setRegisterError(null);
    try {
      await api.registerCharger(identity, {
        providerId: selectedProviderId,
        slotIndex: chargerSlotIndex,
        ratedPowerKw,
        chargerId,
      });
      await loadChargerData(selectedProviderId);
    } catch (err) {
      setRegisterError((err as Error).message);
    } finally {
      setRegisterBusy(false);
    }
  };

  const unboundSlots = slots.filter((slot) => !chargers.some((ch) => ch.slotIndex === Number(slot.slotId)));

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

      {selectedProvider && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
          <span className={`badge provider-${selectedProvider.status}`}>{selectedProvider.status}</span>
          {selectedProvider.status !== 'Deleted' ? (
            <>
              <button onClick={handleToggleStatus}>
                {selectedProvider.status === 'Active' ? 'Close station' : 'Reopen station'}
              </button>
              <button className="danger" onClick={handleDelete}>
                Delete station
              </button>
            </>
          ) : (
            <p style={{ color: '#666', fontStyle: 'italic', margin: 0 }}>
              This station has been permanently deleted.
            </p>
          )}
        </div>
      )}

      {error && <p className="error">{error}</p>}

      {selectedProviderId && (
        <div className="card" style={{ background: '#fafafa' }}>
          <h3>Chargers</h3>
          <p>
            Each slot needs one bound smart-charger device before it can serve sessions. Under the
            trust assumption (see README), readings from a bound charger's identity are treated as
            ground truth for settlement.
          </p>
          {chargers.length > 0 && (
            <ul>
              {chargers.map((c) => (
                <li key={c.chargerId}>
                  Slot {c.slotIndex}: <strong>{c.chargerId}</strong> — {c.ratedPowerKw} kW —{' '}
                  <span className={`badge ${c.status}`}>{c.status}</span>
                </li>
              ))}
            </ul>
          )}

          {unboundSlots.length > 0 ? (
            <div className="row" style={{ alignItems: 'flex-end' }}>
              <div className="field">
                <label>Slot</label>
                <select
                  value={chargerSlotIndex ?? ''}
                  onChange={(e) => setChargerSlotIndex(Number(e.target.value))}
                >
                  {unboundSlots.map((slot) => (
                    <option key={slot.slotId} value={slot.slotId}>
                      Slot {slot.slotId}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Charger identity</label>
                <input value={chargerId} onChange={(e) => setChargerId(e.target.value)} />
              </div>
              <div className="field">
                <label>Rated power (kW)</label>
                <input
                  type="number"
                  value={ratedPowerKw}
                  onChange={(e) => setRatedPowerKw(Number(e.target.value))}
                  min={1}
                />
              </div>
              <button onClick={handleRegisterCharger} disabled={registerBusy}>
                Register charger
              </button>
            </div>
          ) : (
            slots.length > 0 && <p>Every slot has a bound charger.</p>
          )}
          {registerError && <p className="error">{registerError}</p>}
        </div>
      )}

      {reservations.map((r) => {
        const session = sessions[r.reservationId]?.[0];
        return (
          <div key={r.reservationId} className="card" style={{ background: '#fafafa' }}>
            <p>
              <strong>{r.reservationId}</strong> <span className={`badge ${r.state}`}>{r.state}</span>
            </p>
            <p>
              Driver: {r.driverId} · Slot {r.slotId} · Requested {r.requestedEnergy} kWh · Hold{' '}
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
                <p style={{ color: '#666', fontStyle: 'italic' }}>
                  Waiting for the bound charger to start the session (plug-in).
                </p>
              )}
            </div>

            {session && (
              <div style={{ marginTop: 8 }}>
                <p>
                  Session <strong>{session.sessionId}</strong> (charger {session.chargerId}){' '}
                  <span className={`badge ${session.state}`}>{session.state}</span>
                </p>
                {session.state === 'Active' && (
                  <p>
                    Live: {(session.cumulativeWh / 1000).toFixed(3)} kWh delivered so far (
                    {session.readingCount} on-ledger readings) — read-only, machine-reported.
                  </p>
                )}
                {session.state === 'Settled' && (
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
