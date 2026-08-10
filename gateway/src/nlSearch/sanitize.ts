/**
 * Mandatory whitelist between untrusted LLM output and the CouchDB query
 * sent to QueryProviders. Treat `raw` as hostile: it is model output, not
 * validated input — the local model's `format` schema constrains shape, not
 * intent, and a differently-configured or future model could still emit
 * anything. Only fields explicitly recognized below ever survive; everything
 * else (extra keys, injected operators like $where/$regex, malformed types)
 * is silently dropped rather than passed through.
 */

export interface CouchSelector {
  docType: 'provider';
  status: 'Active';
  providerType?: 'Commercial' | 'Residential';
  approvalRequired?: boolean;
  pricePerkWh?: { $lte?: number; $gte?: number };
  // A scalar radius only -- never a coordinate. Per CAR_LOCATION_ADDENDUM.md
  // section 2.1/9, this must NOT be wired into a QueryProviders bounding box
  // (that would send the driver's position to the peer). It exists here so
  // VOICE_INPUT_ADDENDUM.md's parser output goes through the same mandatory
  // clamp/whitelist as every other model-derived field; callers apply it to
  // the marketplace's client-side "within X km" filter instead.
  radiusKm?: number;
}

const MIN_PRICE = 0;
const MAX_PRICE = 1_000_000;
const MIN_RADIUS_KM = 1;
const MAX_RADIUS_KM = 200;

/**
 * A price of 0, negative, missing, or non-integer means "no constraint" —
 * this is the guard against the model emitting 0 as a placeholder for "not
 * mentioned", which would otherwise silently produce a $lte 0 query that
 * matches nothing.
 */
function sanitizePriceBound(raw: unknown): number | undefined {
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw <= 0) return undefined;
  return Math.min(MAX_PRICE, Math.max(MIN_PRICE, raw));
}

export function sanitizeSelector(raw: unknown): CouchSelector {
  const selector: CouchSelector = { docType: 'provider', status: 'Active' };

  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return selector;
  }
  const input = raw as Record<string, unknown>;

  if (input.providerType === 'Commercial' || input.providerType === 'Residential') {
    selector.providerType = input.providerType;
  }

  if (typeof input.approvalRequired === 'boolean') {
    selector.approvalRequired = input.approvalRequired;
  }

  const lte = sanitizePriceBound(input.maxPricePerkWh);
  const gte = sanitizePriceBound(input.minPricePerkWh);
  if (lte !== undefined || gte !== undefined) {
    selector.pricePerkWh = {};
    if (lte !== undefined) selector.pricePerkWh.$lte = lte;
    if (gte !== undefined) selector.pricePerkWh.$gte = gte;
  }

  if (
    typeof input.radiusKm === 'number' &&
    Number.isInteger(input.radiusKm) &&
    input.radiusKm >= MIN_RADIUS_KM
  ) {
    selector.radiusKm = Math.min(MAX_RADIUS_KM, input.radiusKm);
  }

  return selector;
}
