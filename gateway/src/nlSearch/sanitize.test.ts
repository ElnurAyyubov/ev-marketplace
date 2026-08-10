import { describe, expect, it } from 'vitest';
import { sanitizeSelector } from './sanitize';

describe('sanitizeSelector', () => {
  it('always forces docType and status regardless of input', () => {
    expect(sanitizeSelector({})).toEqual({ docType: 'provider', status: 'Active' });
    expect(sanitizeSelector({ docType: 'reservation', status: 'Inactive' })).toEqual({
      docType: 'provider',
      status: 'Active',
    });
  });

  it('"under 25" maps maxPricePerkWh to pricePerkWh.$lte', () => {
    const out = sanitizeSelector({ maxPricePerkWh: 25 });
    expect(out.pricePerkWh).toEqual({ $lte: 25 });
  });

  it('maxPricePerkWh of 0 produces NO pricePerkWh key (placeholder-zero regression)', () => {
    const out = sanitizeSelector({ maxPricePerkWh: 0 });
    expect(out).toEqual({ docType: 'provider', status: 'Active' });
    expect(out).not.toHaveProperty('pricePerkWh');
  });

  it('missing price produces NO pricePerkWh key', () => {
    const out = sanitizeSelector({ providerType: 'Commercial' });
    expect(out).not.toHaveProperty('pricePerkWh');
  });

  it('combines minPricePerkWh and maxPricePerkWh into a single range', () => {
    const out = sanitizeSelector({ minPricePerkWh: 10, maxPricePerkWh: 30 });
    expect(out.pricePerkWh).toEqual({ $gte: 10, $lte: 30 });
  });

  it('drops negative and non-integer prices as "no constraint", not as 0', () => {
    expect(sanitizeSelector({ maxPricePerkWh: -5 })).not.toHaveProperty('pricePerkWh');
    expect(sanitizeSelector({ maxPricePerkWh: 12.5 })).not.toHaveProperty('pricePerkWh');
    expect(sanitizeSelector({ maxPricePerkWh: '25' })).not.toHaveProperty('pricePerkWh');
  });

  it('clamps an out-of-range price instead of rejecting the whole selector', () => {
    const out = sanitizeSelector({ maxPricePerkWh: 99_999_999 });
    expect(out.pricePerkWh).toEqual({ $lte: 1_000_000 });
  });

  it('injected $where and a nested $regex operator are stripped, leaving only whitelisted keys', () => {
    const out = sanitizeSelector({
      providerType: 'Commercial',
      maxPricePerkWh: 25,
      $where: 'function() { return true; }',
      pricePerkWh: { $lte: 25, $where: 'malicious', $regex: '.*' },
      extraField: 'sneaky',
      nested: { $or: [{ ownerId: { $regex: '.*' } }] },
    });
    expect(out).toEqual({
      docType: 'provider',
      status: 'Active',
      providerType: 'Commercial',
      pricePerkWh: { $lte: 25 },
    });
    expect(out).not.toHaveProperty('$where');
    expect(out).not.toHaveProperty('extraField');
    expect(out).not.toHaveProperty('nested');
  });

  it('rejects an invalid providerType instead of passing it through', () => {
    const out = sanitizeSelector({ providerType: 'Hotel' });
    expect(out.providerType).toBeUndefined();
  });

  it('rejects a non-boolean approvalRequired (string "false" is not false)', () => {
    const out = sanitizeSelector({ approvalRequired: 'false' });
    expect(out.approvalRequired).toBeUndefined();
  });

  it('"within 10 km" maps radiusKm through, clamped to the whitelist', () => {
    const out = sanitizeSelector({ radiusKm: 10 });
    expect(out.radiusKm).toBe(10);
  });

  it('clamps an out-of-range radius to 200 instead of rejecting the whole selector', () => {
    expect(sanitizeSelector({ radiusKm: 999_999 }).radiusKm).toBe(200);
  });

  it('drops a negative or zero radius as "no constraint" (VOICE_INPUT_ADDENDUM.md section 3 clamps)', () => {
    expect(sanitizeSelector({ radiusKm: -5 })).not.toHaveProperty('radiusKm');
    expect(sanitizeSelector({ radiusKm: 0 })).not.toHaveProperty('radiusKm');
  });

  it('drops a non-integer or string radius rather than coercing it', () => {
    expect(sanitizeSelector({ radiusKm: 12.5 })).not.toHaveProperty('radiusKm');
    expect(sanitizeSelector({ radiusKm: '10' })).not.toHaveProperty('radiusKm');
  });

  it('missing radius produces NO radiusKm key', () => {
    expect(sanitizeSelector({ providerType: 'Commercial' })).not.toHaveProperty('radiusKm');
  });

  it('rejects arrays and primitives as the top-level input', () => {
    expect(sanitizeSelector(['$where', 'x'])).toEqual({ docType: 'provider', status: 'Active' });
    expect(sanitizeSelector('drop everything')).toEqual({ docType: 'provider', status: 'Active' });
    expect(sanitizeSelector(null)).toEqual({ docType: 'provider', status: 'Active' });
    expect(sanitizeSelector(undefined)).toEqual({ docType: 'provider', status: 'Active' });
  });
});
