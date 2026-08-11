import { useState } from 'react';
import { DemoActivityLog } from './DemoActivityLog';
import { DemoBookingMode, DemoPhase } from './types';
import { UseDemoRunnerResult } from './useDemoRunner';

interface Props {
  runner: UseDemoRunnerResult;
  stopCount: number;
}

const DEFAULT_SPEED_KMH = 3000;
const DEFAULT_ENERGY_PER_STOP_KWH = '20';
const CONFLICT_STOP_INDEX = 1; // "stop 2", per DEMO_RUNNER_ADDENDUM.md section 8/9 (D5)'s worked example

function describePhase(phase: DemoPhase): string {
  switch (phase.kind) {
    case 'idle':
      return 'Idle';
    case 'driving':
      return `Driving leg ${phase.legIndex + 1} (${Math.round(phase.progress * 100)}%)`;
    case 'arrived':
      return `Arrived, leg ${phase.legIndex + 1}`;
    case 'reserving':
      return `Reserving stop ${phase.legIndex + 1}`;
    case 'waiting': {
      const opensIn = Math.max(0, phase.opensAt - Math.floor(Date.now() / 1000));
      return `Waiting for reservation window to open (stop ${phase.legIndex + 1}, ~${Math.ceil(opensIn / 60)} min)`;
    }
    case 'plugging':
      return `Plugging in, stop ${phase.legIndex + 1}`;
    case 'charging':
      return `Charging, stop ${phase.legIndex + 1}`;
    case 'settled':
      return `Settled, stop ${phase.legIndex + 1}`;
    case 'done':
      return 'Trip complete';
    case 'failed':
      return `Failed at leg ${phase.legIndex + 1}: ${phase.reason}`;
  }
}

/**
 * Dev-only demo controls (DEMO_RUNNER_ADDENDUM.md section 2.2/3/4/8).
 * Mounted only under VITE_ENABLE_DEV_DEMO -- see DemoTripSection.tsx.
 */
export function DemoControlBar({ runner, stopCount }: Props) {
  const [speedKmh, setSpeedKmh] = useState(DEFAULT_SPEED_KMH);
  const [energyPerStopKwh, setEnergyPerStopKwh] = useState(DEFAULT_ENERGY_PER_STOP_KWH);
  const [bookingMode, setBookingMode] = useState<DemoBookingMode>('on-arrival');

  const canInjectConflict = runner.running && stopCount > CONFLICT_STOP_INDEX;

  return (
    <div style={{ background: '#fff7e6', border: '1px solid #e0b84a', borderRadius: 6, padding: 10, marginTop: 12 }}>
      <strong>Demo runner</strong>
      <span style={{ fontSize: 12, color: '#8a6d1a', marginLeft: 8 }}>dev-only, not part of the product</span>

      <div className="row" style={{ marginTop: 8, alignItems: 'flex-end' }}>
        <div className="field" style={{ maxWidth: 140 }}>
          <label>Speed (km/h)</label>
          <input
            type="number"
            min="20"
            value={speedKmh}
            onChange={(e) => setSpeedKmh(Number(e.target.value))}
            disabled={runner.running}
          />
        </div>
        <div className="field" style={{ maxWidth: 140 }}>
          <label>Energy per stop (kWh)</label>
          <input
            type="number"
            min="1"
            value={energyPerStopKwh}
            onChange={(e) => setEnergyPerStopKwh(e.target.value)}
            disabled={runner.running}
          />
        </div>
        <div className="field" style={{ maxWidth: 200 }}>
          <label>Booking</label>
          <select
            value={bookingMode}
            onChange={(e) => setBookingMode(e.target.value as DemoBookingMode)}
            disabled={runner.running}
          >
            <option value="on-arrival">Book each stop on arrival</option>
            <option value="upfront">Book whole trip upfront</option>
          </select>
        </div>
        {!runner.running ? (
          <button
            onClick={() =>
              runner.start({
                assumedSpeedKmh: speedKmh,
                requestedEnergyWhPerStop: Math.round(Number(energyPerStopKwh) * 1000),
                bookingMode,
              })
            }
          >
            Run demo
          </button>
        ) : (
          <button className="secondary" onClick={runner.stop}>
            Stop
          </button>
        )}
      </div>

      {bookingMode === 'upfront' && !runner.running && (
        <p style={{ fontSize: 12, color: '#8a6d1a', margin: '6px 0 0' }}>
          Booking the whole trip upfront genuinely waits for each stop's reservation window to open (~20 min per
          stop) -- this mode is slow by design; it demonstrates pre-reservation, not speed.
        </p>
      )}

      <div className="row" style={{ marginTop: 8, alignItems: 'center' }}>
        <button
          className="secondary"
          disabled={!canInjectConflict}
          onClick={() => runner.injectConflictAtStop(CONFLICT_STOP_INDEX)}
          title="Books the same slot/window as a second driver identity, exercising the real 409 conflict path (D5)"
        >
          Inject conflict at stop {CONFLICT_STOP_INDEX + 1}
        </button>
      </div>

      <p style={{ fontSize: 13, margin: '8px 0 0' }}>{describePhase(runner.phase)}</p>
      <DemoActivityLog events={runner.events} />
    </div>
  );
}
