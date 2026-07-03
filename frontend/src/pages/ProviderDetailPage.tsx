import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useIdentity } from '../context/IdentityContext';
import { ChargingProvider, Slot } from '../api/types';

interface Props {
  providerId: string;
  onBack: () => void;
  onReserved: (reservationId: string) => void;
}

export function ProviderDetailPage({ providerId, onBack, onReserved }: Props) {
  const { identity } = useIdentity();
  const [provider, setProvider] = useState<ChargingProvider | null>(null);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [requestedEnergy, setRequestedEnergy] = useState(10);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  const load = async () => {
    const [p, s] = await Promise.all([
      api.getProvider(identity, providerId),
      api.getSlots(identity, providerId),
    ]);
    setProvider(p);
    setSlots(s);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [providerId]);

  const handleReserve = async () => {
    if (!selectedSlot) return;
    setError(null);
    setResult(null);
    try {
      const { reservationId } = await api.createReservation(identity, {
        providerId,
        slotId: selectedSlot,
        requestedEnergy,
      });
      setResult(
        provider?.approvalRequired
          ? `Reservation ${reservationId} created — awaiting owner approval.`
          : `Reservation ${reservationId} confirmed, escrow locked.`
      );
      onReserved(reservationId);
      load();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  if (!provider) return <div className="card">Loading...</div>;

  return (
    <div className="card">
      <button className="secondary" onClick={onBack}>
        ← Back to marketplace
      </button>
      <h2>{provider.locationLabel}</h2>
      <p>
        {provider.providerType} · {provider.pricePerkWh}/kWh · {provider.connectorTypes.join(', ')}
      </p>
      {provider.approvalRequired && (
        <p>
          <em>This provider requires owner approval before a reservation is confirmed.</em>
        </p>
      )}

      <h3>Slots</h3>
      <div className="slot-grid">
        {slots.map((s) => (
          <div
            key={s.slotId}
            className={`slot ${s.occupied ? 'occupied' : ''} ${
              selectedSlot === s.slotId ? 'selected' : ''
            }`}
            onClick={() => !s.occupied && setSelectedSlot(s.slotId)}
          >
            Slot {s.slotId} {s.occupied ? '(occupied)' : ''}
          </div>
        ))}
      </div>

      <div className="field" style={{ marginTop: 12 }}>
        <label>Requested energy (kWh)</label>
        <input
          type="number"
          value={requestedEnergy}
          onChange={(e) => setRequestedEnergy(Number(e.target.value))}
          min={1}
        />
      </div>

      <button onClick={handleReserve} disabled={!selectedSlot}>
        Reserve as {identity}
      </button>

      {result && <p>{result}</p>}
      {error && <p className="error">{error}</p>}
    </div>
  );
}
