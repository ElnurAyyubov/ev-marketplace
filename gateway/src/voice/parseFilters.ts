/**
 * Deterministic English utterance -> marketplace filter extraction
 * (VOICE_INPUT_ADDENDUM.md section 3). Pure function of a string: no I/O, no
 * network, byte-identical on repeated runs. This is the primary path; the
 * LLM (routes/voice.ts) is invoked only when this matches zero fields.
 *
 * Exactly four extractable fields, ever: providerType, approvalRequired,
 * maxPricePerkWh, radiusKm. radiusKm is a scalar only -- see the comment on
 * CouchSelector.radiusKm in nlSearch/sanitize.ts for why it must never
 * become a coordinate or a QueryProviders bounding box.
 */
export interface VoiceFilters {
  providerType?: 'Commercial' | 'Residential';
  approvalRequired?: boolean;
  maxPricePerkWh?: number;
  radiusKm?: number;
}

export interface ParseResult {
  filters: VoiceFilters;
  /** Count of explicitly spoken fields, BEFORE Rule 2's default radius is applied -- this is what gates the LLM fallback. */
  matched: number;
  /** True when radiusKm was populated by Rule 2's default rather than an explicit spoken distance. */
  nearbyApplied: boolean;
}

const UNITS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
  sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS: Record<string, number> = {
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};

export const NEARBY_RADIUS_KM = Number(process.env.VOICE_NEARBY_RADIUS_KM ?? 25);

function wordsToDigits(s: string): string {
  const toks = s.split(' ');
  const out: string[] = [];
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t in TENS) {
      const next = toks[i + 1];
      if (next && next in UNITS && UNITS[next] > 0 && UNITS[next] < 10) {
        out.push(String(TENS[t] + UNITS[next]));
        i++;
        continue; // "twenty five" -> 25
      }
      out.push(String(TENS[t]));
      continue;
    }
    if (t in UNITS) {
      out.push(String(UNITS[t]));
      continue;
    }
    if (t === 'hundred') {
      const prev = out[out.length - 1];
      if (prev && /^\d+$/.test(prev)) out[out.length - 1] = String(Number(prev) * 100);
      else out.push('100');
      continue;
    }
    out.push(t);
  }
  return out.join(' ');
}

function normalize(raw: string): string {
  const s = raw.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  return wordsToDigits(s.replace(/\bkilomet(?:er|re)s?\b|\bk m\b|\bkays?\b/g, 'km'));
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export function parseVoiceFilters(raw: string): ParseResult {
  let s = normalize(raw);
  const f: VoiceFilters = {};

  // RULE 1a -- distance first; its unit is unambiguous, so it consumes its number.
  const dist = s.match(/(\d+)\s*(km|mi|miles?)\b/);
  if (dist) {
    const n = Number(dist[1]);
    f.radiusKm = clamp(dist[2].startsWith('mi') ? Math.round(n * 1.609) : n, 1, 200);
    s = s.replace(dist[0], ' '); // remove so it cannot be re-read as a price
  }

  // RULE 1b -- any remaining number is a price. Cue words are optional.
  const price = s.match(/(\d+)/);
  if (price) f.maxPricePerkWh = clamp(Number(price[1]), 1, 1_000_000);

  // Provider type.
  if (/\b(residential|home|house|private|neighbou?r)\b/.test(s)) f.providerType = 'Residential';
  else if (/\b(commercial|public|station|business|compan)\b/.test(s)) f.providerType = 'Commercial';

  // Approval -- negation checked FIRST.
  if (/\b(no|without|not)\s+\w*\s*(approval|confirmation|permission)\b|\binstant\b|\bauto\w*\s+approv/.test(s)) {
    f.approvalRequired = false;
  } else if (/\bapprov|\bpermission\b/.test(s)) {
    f.approvalRequired = true;
  }

  const matched = Object.keys(f).length;
  const nearbyApplied = matched > 0 && f.radiusKm === undefined;

  // RULE 2 -- no distance unit spoken means "nearby", applied only if
  // something else matched. Applied AFTER matched is computed so an
  // utterance that matched nothing still reports matched = 0 and triggers
  // the LLM fallback rather than returning a lone default radius.
  if (nearbyApplied) f.radiusKm = NEARBY_RADIUS_KM;

  return { filters: f, matched, nearbyApplied };
}
