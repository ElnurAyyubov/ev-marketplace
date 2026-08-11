import { useState } from 'react';
import { DemoActivityLog } from './DemoActivityLog';
import { DemoPhase } from './types';
import { UseDemoRunnerResult } from './useDemoRunner';

interface Props {
  runner: UseDemoRunnerResult;
}

const DEFAULT_SPEED_KMH = 3000;
const DEFAULT_ENERGY_PER_STOP_KWH = '20';

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
    case 'waiting':
      return `Waiting for reservation window to open (stop ${phase.legIndex + 1})`;
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
 * Dev-only demo controls (DEMO_RUNNER_ADDENDUM.md section 2.2/3/4). Mounted
 * only under VITE_ENABLE_DEV_DEMO -- see DemoTripSection.tsx.
 */
export function DemoControlBar({ runner }: Props) {
  const [speedKmh, setSpeedKmh] = useState(DEFAULT_SPEED_KMH);
  const [energyPerStopKwh, setEnergyPerStopKwh] = useState(DEFAULT_ENERGY_PER_STOP_KWH);

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
        {!runner.running ? (
          <button
            onClick={() =>
              runner.start({
                assumedSpeedKmh: speedKmh,
                requestedEnergyWhPerStop: Math.round(Number(energyPerStopKwh) * 1000),
                bookingMode: 'on-arrival',
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

      <p style={{ fontSize: 13, margin: '8px 0 0' }}>{describePhase(runner.phase)}</p>
      <DemoActivityLog events={runner.events} />
    </div>
  );
}
