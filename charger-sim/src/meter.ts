/**
 * Computes delivered energy from ratedPowerKw * elapsed time, per Addendum A
 * section 6 -- never a made-up per-tick constant.
 */
export function computeIncrementWh(ratedPowerKw: number, elapsedMs: number): number {
  const elapsedHours = elapsedMs / 3_600_000;
  return Math.round(ratedPowerKw * elapsedHours * 1000);
}
