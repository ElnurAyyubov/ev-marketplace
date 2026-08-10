import { describe, expect, it } from 'vitest';
import { NEARBY_RADIUS_KM, parseVoiceFilters } from './parseFilters';

// VOICE_INPUT_ADDENDUM.md section 8, milestone V1 acceptance table. Rows 4
// ("under 50 kilometers") and 7 ("hello can you hear me") are the two that
// catch real bugs -- a naive implementation double-counts the distance
// number as a price, or defaults a radius onto an utterance that matched
// nothing at all.
describe('parseVoiceFilters', () => {
  it('"residential chargers under thirty" -> type + price, Rule 2 nearby default', () => {
    const { filters, matched } = parseVoiceFilters('residential chargers under thirty');
    expect(filters).toEqual({
      providerType: 'Residential',
      maxPricePerkWh: 30,
      radiusKm: NEARBY_RADIUS_KM,
    });
    expect(matched).toBe(2);
  });

  it('"commercial stations no approval needed" -> type + approval false, Rule 2 default', () => {
    const { filters, matched } = parseVoiceFilters('commercial stations no approval needed');
    expect(filters).toEqual({
      providerType: 'Commercial',
      approvalRequired: false,
      radiusKm: NEARBY_RADIUS_KM,
    });
    expect(matched).toBe(2);
  });

  it('"within ten km under twenty" -> explicit radius wins, remaining number is price', () => {
    const { filters, matched } = parseVoiceFilters('within ten km under twenty');
    expect(filters).toEqual({ radiusKm: 10, maxPricePerkWh: 20 });
    expect(matched).toBe(2);
  });

  it('"under 50 kilometers" is read as ONLY a radius, never also as a price (regression)', () => {
    const { filters, matched } = parseVoiceFilters('under 50 kilometers');
    expect(filters).toEqual({ radiusKm: 50 });
    expect(filters.maxPricePerkWh).toBeUndefined();
    expect(matched).toBe(1);
  });

  it('"home chargers that need approval" -> type + approval true, Rule 2 default', () => {
    const { filters, matched } = parseVoiceFilters('home chargers that need approval');
    expect(filters).toEqual({
      providerType: 'Residential',
      approvalRequired: true,
      radiusKm: NEARBY_RADIUS_KM,
    });
    expect(matched).toBe(2);
  });

  it('"twenty five miles" converts to km and is the only field', () => {
    const { filters, matched } = parseVoiceFilters('twenty five miles');
    expect(filters).toEqual({ radiusKm: 40 }); // round(25 * 1.609) = 40
    expect(matched).toBe(1);
  });

  it('"hello can you hear me" matches nothing -- no lone default radius (regression)', () => {
    const { filters, matched } = parseVoiceFilters('hello can you hear me');
    expect(filters).toEqual({});
    expect(matched).toBe(0);
  });

  it('is a pure function: repeated runs on the same input are byte-identical', () => {
    const a = parseVoiceFilters('residential chargers under thirty within ten km, no approval');
    const b = parseVoiceFilters('residential chargers under thirty within ten km, no approval');
    expect(a).toEqual(b);
  });

  it('V4 demo utterance matches all four fields with an explicit (non-defaulted) radius', () => {
    const { filters, matched, nearbyApplied } = parseVoiceFilters(
      'residential chargers under thirty within ten km, no approval'
    );
    expect(filters).toEqual({
      providerType: 'Residential',
      maxPricePerkWh: 30,
      radiusKm: 10,
      approvalRequired: false,
    });
    expect(matched).toBe(4);
    expect(nearbyApplied).toBe(false);
  });

  it('negation is checked before the positive approval case', () => {
    expect(parseVoiceFilters('no approval needed').filters.approvalRequired).toBe(false);
    expect(parseVoiceFilters('approval required please').filters.approvalRequired).toBe(true);
  });

  it('clamps an out-of-range spoken price and radius to the documented bounds', () => {
    expect(parseVoiceFilters('under 5000000').filters.maxPricePerkWh).toBe(1_000_000);
    expect(parseVoiceFilters('within 500 km').filters.radiusKm).toBe(200);
  });
});
