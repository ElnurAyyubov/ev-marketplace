/**
 * English -> JSON translator for the natural-language provider search.
 *
 * Scope boundary (see NL_SEARCH_ADDENDUM.md §3): QueryProviders can only
 * filter on fields that actually exist on-ledger. Constraints like a place
 * name ("near downtown") or a schedule ("open after 9pm") have no queryable
 * field in the MVP schema and must be silently dropped, not hallucinated
 * into a nearby field or a fabricated coordinate.
 *
 * The model runs locally via Ollama with `format` set to
 * NL_SEARCH_RESPONSE_FORMAT below, so the shape of its output is guaranteed
 * by constrained decoding. sanitizeSelector() is still the mandatory last
 * line of defense before this reaches QueryProviders — see sanitize.ts.
 */
export const SYSTEM_PROMPT = `You extract EV-charger search filters into JSON. Fields:
- providerType: 'Commercial' or 'Residential' if the user specifies a kind of charger.
- approvalRequired: false if the user wants no approval / instant booking; true if they require/accept approval; omit if not mentioned.
- maxPricePerkWh: the maximum price the user accepts, from phrases like 'under 25', 'below 30', 'max 20'. Integer.
- minPricePerkWh: a minimum price if the user gives a range. Integer.
Only include a field the user actually mentioned. If the user gives no price, OMIT the price field entirely — never output 0 as a placeholder. Output only the JSON object.`;

/** Passed as `format` to Ollama's /api/chat — constrained decoding guarantees this shape. */
export const NL_SEARCH_RESPONSE_FORMAT = {
  type: 'object',
  properties: {
    providerType: {
      type: 'string',
      enum: ['Commercial', 'Residential'],
      description: 'Commercial or Residential charger',
    },
    approvalRequired: {
      type: 'boolean',
      description: 'false if user wants no approval required',
    },
    maxPricePerkWh: {
      type: 'integer',
      description: 'max acceptable price per kWh; from under/below/max N',
    },
    minPricePerkWh: {
      type: 'integer',
      description: 'min price per kWh if user gives a range',
    },
  },
} as const;
