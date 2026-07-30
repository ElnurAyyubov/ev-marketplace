/**
 * English -> structured trip request (TRIP_PLANNER_ADDENDUM.md §3.2).
 * The model extracts origin/destination as free-text place *names* -- never
 * coordinates -- plus the same constraint fields as the existing NL-search
 * sanitizer, reused verbatim (see sanitize.ts). It never picks stations,
 * orders stops, or judges feasibility; that's the deterministic planner's
 * job (planner.ts), run afterward by the route handler.
 */
import { sanitizeSelector } from '../nlSearch/sanitize';
import { PlanConstraints } from './types';

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'qwen2.5:3b-instruct';

export const TRIP_NL_SYSTEM_PROMPT = `You extract an EV trip request into JSON. Fields:
- origin: the starting place name the user mentions (a city, neighborhood, or landmark). Never coordinates.
- destination: the ending place name the user mentions. Never coordinates.
- providerType: 'Commercial' or 'Residential' if the user specifies a kind of charger.
- approvalRequired: false if the user wants no approval / instant booking; true if they require/accept approval; omit if not mentioned.
- maxPricePerkWh: the maximum price the user accepts, from phrases like 'under 25', 'below 30', 'max 20'. Integer.
- minPricePerkWh: a minimum price if the user gives a range. Integer.
origin and destination are required. Only include a constraint field the user actually mentioned. If the user gives no price, OMIT the price field entirely -- never output 0 as a placeholder. Output only the JSON object.`;

export const TRIP_NL_RESPONSE_FORMAT = {
  type: 'object',
  properties: {
    origin: { type: 'string', description: 'Starting place name, e.g. a city or neighborhood.' },
    destination: { type: 'string', description: 'Destination place name.' },
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
  required: ['origin', 'destination'],
} as const;

interface OllamaChatResponse {
  message?: { content?: string };
}

export interface ParsedTripQuery {
  origin: string;
  destination: string;
  constraints: PlanConstraints;
}

/**
 * Throws on any failure (network, malformed JSON, missing origin/destination)
 * -- the route handler turns that into a 502, per the addendum's failure
 * table ("Ollama down during NL parse -> 502, never falls through to an
 * unparsed/unfiltered query").
 */
export async function parseTripQuery(query: string): Promise<ParsedTripQuery> {
  const response = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      stream: false,
      // Fixed for run-to-run stability, matching the NL-search convention
      // (see gateway/README.md "Model provenance" for what this does and
      // does not guarantee).
      options: { temperature: 0, seed: 42 },
      messages: [
        { role: 'system', content: TRIP_NL_SYSTEM_PROMPT },
        { role: 'user', content: query },
      ],
      format: TRIP_NL_RESPONSE_FORMAT,
    }),
  });
  if (!response.ok) throw new Error(`Ollama request failed with status ${response.status}`);

  const data = (await response.json()) as OllamaChatResponse;
  const parsed = JSON.parse(data.message?.content ?? '') as Record<string, unknown>;

  if (typeof parsed.origin !== 'string' || !parsed.origin.trim()) {
    throw new Error('model did not produce an origin');
  }
  if (typeof parsed.destination !== 'string' || !parsed.destination.trim()) {
    throw new Error('model did not produce a destination');
  }

  // sanitizeSelector is mandatory here too: parsed is untrusted model
  // output. Reused verbatim from NL search -- only the pricePerkWh.$lte
  // half maps onto PlanConstraints (it has no minPricePerkWh field, see
  // types.ts / addendum §5).
  const selector = sanitizeSelector(parsed);
  const constraints: PlanConstraints = {
    providerType: selector.providerType,
    approvalRequired: selector.approvalRequired,
    maxPricePerkWh: selector.pricePerkWh?.$lte,
  };

  return { origin: parsed.origin.trim(), destination: parsed.destination.trim(), constraints };
}
