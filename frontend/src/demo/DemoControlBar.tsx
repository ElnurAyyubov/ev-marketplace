import { useState } from 'react';
import { UseDemoRunnerResult } from './useDemoRunner';

interface Props {
  runner: UseDemoRunnerResult;
}

const DEFAULT_SPEED_KMH = 3000;

/**
 * Dev-only demo controls (DEMO_RUNNER_ADDENDUM.md section 2.2/3). Mounted
 * only under VITE_ENABLE_DEV_DEMO -- see TripPlannerPage.tsx.
 */
export function DemoControlBar({ runner }: Props) {
  const [speedKmh, setSpeedKmh] = useState(DEFAULT_SPEED_KMH);

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
        {!runner.running ? (
          <button onClick={() => runner.start(speedKmh)}>Run demo</button>
        ) : (
          <button className="secondary" onClick={runner.stop}>
            Stop
          </button>
        )}
      </div>
    </div>
  );
}
