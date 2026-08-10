import { describe, expect, it } from 'vitest';
import { distanceKm } from './distance';

describe('distanceKm', () => {
  it('is zero for identical points', () => {
    expect(distanceKm({ lat: 41.0082, lng: 28.9784 }, { lat: 41.0082, lng: 28.9784 })).toBe(0);
  });

  it('matches the known great-circle distance between two named cities', () => {
    // Istanbul -> Ankara, ~349 km great-circle (WGS84 references agree to
    // within a couple km using the mean earth radius this function assumes).
    const istanbul = { lat: 41.0082, lng: 28.9784 };
    const ankara = { lat: 39.9334, lng: 32.8597 };
    expect(distanceKm(istanbul, ankara)).toBeCloseTo(349, 0);
  });

  it('matches one degree of longitude at the equator (~111.2 km)', () => {
    expect(distanceKm({ lat: 0, lng: 0 }, { lat: 0, lng: 1 })).toBeCloseTo(111.19, 1);
  });
});
