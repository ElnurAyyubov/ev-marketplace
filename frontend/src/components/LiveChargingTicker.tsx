import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useIdentity } from '../context/IdentityContext';
import { Reservation, Session } from '../api/types';

interface Anchor {
  wh: number;
  atMs: number;
}

const READING_POLL_MS = 3000;
const TICK_MS = 200;

/**
 * Demo centerpiece (Addendum A section 8): kWh delivered and running cost,
 * counting up continuously. Between on-ledger readings, the displayed
 * value is interpolated at the charger's ratedPowerKw rate; each poll of
 * GET /sessions/:id/readings re-anchors to the true on-ledger cumulative
 * value. The interpolation is presentation only and never feeds
 * settlement -- every anchor is a real committed ledger record.
 */
export function LiveChargingTicker({
  reservation,
  session,
  onStopped,
}: {
  reservation: Reservation;
  session: Session;
  onStopped: () => void;
}) {
  const { identity } = useIdentity();
  const [ratedPowerKw, setRatedPowerKw] = useState<number | null>(null);
  const [pricePerkWh, setPricePerkWh] = useState<number | null>(null);
  const [anchor, setAnchor] = useState<Anchor>({ wh: session.cumulativeWh, atMs: Date.now() });
  const [displayedWh, setDisplayedWh] = useState(session.cumulativeWh);
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.getCharger(identity, session.chargerId), api.getProvider(identity, reservation.providerId)])
      .then(([charger, provider]) => {
        setRatedPowerKw(charger.ratedPowerKw);
        setPricePerkWh(provider.pricePerkWh);
      })
      .catch((err) => setError((err as Error).message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.sessionId]);

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const readings = await api.getSessionReadings(identity, session.sessionId);
        if (cancelled || readings.length === 0) return;
        const latest = readings[readings.length - 1];
        setAnchor((prev) => (prev.wh === latest.cumulativeWh ? prev : { wh: latest.cumulativeWh, atMs: Date.now() }));
      } catch {
        // transient poll failure; the next tick retries
      }
    };
    poll();
    const interval = setInterval(poll, READING_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [identity, session.sessionId]);

  useEffect(() => {
    if (ratedPowerKw === null) return;
    const tick = () => {
      const elapsedHours = (Date.now() - anchor.atMs) / 3_600_000;
      setDisplayedWh(anchor.wh + ratedPowerKw * elapsedHours * 1000);
    };
    tick();
    const interval = setInterval(tick, TICK_MS);
    return () => clearInterval(interval);
  }, [anchor, ratedPowerKw]);

  const handleStop = async () => {
    setStopping(true);
    setError(null);
    try {
      await api.stopSession(identity, session.sessionId);
      onStopped();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setStopping(false);
    }
  };

  const displayedCost = pricePerkWh !== null ? Math.floor((displayedWh * pricePerkWh) / 1000) : null;

  return (
    <div className="ticker">
      <p className="ticker-kwh">{(displayedWh / 1000).toFixed(3)} kWh delivered</p>
      <p className="ticker-cost">{displayedCost !== null ? `~${displayedCost} running cost` : 'loading rate…'}</p>
      <p style={{ fontSize: 12, color: '#666' }}>
        {ratedPowerKw !== null ? `${ratedPowerKw} kW charger` : 'loading charger…'} · {session.readingCount}{' '}
        on-ledger reading{session.readingCount === 1 ? '' : 's'}
      </p>
      <button onClick={handleStop} disabled={stopping}>
        {stopping ? 'Stopping…' : 'Stop Charging'}
      </button>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
