import { describe, expect, it } from 'vitest';
import { computeWindows, WINDOW_BUFFER_SECONDS } from './windowPlan';
import { LatLng } from './types';

/** Mirrors SmartContract.java's deriveWindowEnd (integer floor division), section 3.4. */
function chaincodeWindowEnd(windowStart: number, requestedEnergyWh: number, ratedPowerKw: number): number {
  const chargeSeconds = Math.floor((requestedEnergyWh * 3600) / (ratedPowerKw * 1000));
  return windowStart + chargeSeconds + WINDOW_BUFFER_SECONDS;
}

function loc(lat: number, lng: number): LatLng {
  return { lat, lng };
}

describe('computeWindows', () => {
  it("never proposes a windowStart earlier than the previous leg's chaincode-derived windowEnd, across a range of energies and rated powers", () => {
    const energies = [1000, 5000, 12345, 20000, 49999, 60000];
    const powers = [3, 7, 11, 22, 50, 150];
    const departAt = 1_700_000_000;
    const assumedSpeedKmh = 80;

    for (const energyWh of energies) {
      for (const ratedPowerKw of powers) {
        const legs = [
          { location: loc(0, 0), requestedEnergyWh: energyWh, ratedPowerKw },
          { location: loc(0.5, 0.5), requestedEnergyWh: energyWh, ratedPowerKw },
          { location: loc(1, 1), requestedEnergyWh: energyWh, ratedPowerKw },
        ];
        const windows = computeWindows(legs, departAt, assumedSpeedKmh, loc(-0.5, -0.5));

        for (let i = 0; i < windows.length; i++) {
          const cc = chaincodeWindowEnd(windows[i].windowStart, energyWh, ratedPowerKw);
          expect(windows[i].windowEnd).toBeGreaterThanOrEqual(cc);
          if (i > 0) {
            const previousCc = chaincodeWindowEnd(windows[i - 1].windowStart, energyWh, ratedPowerKw);
            expect(windows[i].windowStart).toBeGreaterThanOrEqual(previousCc);
          }
        }
      }
    }
  });

  it('produces strictly increasing, integer windowStart values, including with no origin supplied', () => {
    const legs = [
      { location: loc(0, 0), requestedEnergyWh: 15000, ratedPowerKw: 22 },
      { location: loc(1, 1), requestedEnergyWh: 15000, ratedPowerKw: 22 },
    ];
    const windows = computeWindows(legs, 1_700_000_000, 80);

    expect(Number.isInteger(windows[0].windowStart)).toBe(true);
    expect(windows[0].windowStart).toBe(1_700_000_000);
    expect(windows[1].windowStart).toBeGreaterThan(windows[0].windowStart);
  });
});
