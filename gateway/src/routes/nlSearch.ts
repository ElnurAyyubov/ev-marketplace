import { Router } from 'express';
import { withContract } from '../fabric';
import { boundingBoxSelector, haversineKm, LAT_LNG_SCALE } from '../geo';
import { NL_SEARCH_RESPONSE_FORMAT, SYSTEM_PROMPT } from '../nlSearch/prompt';
import { sanitizeSelector } from '../nlSearch/sanitize';
import { asyncHandler, HttpError, requireIdentity } from './util';

export const nlSearchRouter = Router();

// Local-only: this endpoint never calls a hosted LLM API. See gateway/README.md
// "Natural-language search" section for setup and the model-provenance note.
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'qwen2.5:3b-instruct';

interface ChargingProviderResult {
  latitude: number;
  longitude: number;
  [key: string]: unknown;
}

interface OllamaChatResponse {
  message?: { content?: string };
}

nlSearchRouter.post(
  '/search/nl',
  asyncHandler(async (req, res) => {
    const identity = requireIdentity(req);
    const { query, center } = (req.body ?? {}) as {
      query?: string;
      center?: { lat: number; lng: number; radiusKm: number };
    };
    if (typeof query !== 'string' || !query.trim()) {
      throw new HttpError(400, 'query is required');
    }

    let selector;
    try {
      const response = await fetch(`${OLLAMA_URL}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: OLLAMA_MODEL,
          stream: false,
          // Fixed for run-to-run stability during development/demo — see
          // gateway/README.md "Model provenance" for what this does and
          // does not guarantee.
          options: { temperature: 0, seed: 42 },
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: query },
          ],
          // Constrained decoding: Ollama guarantees the model output matches
          // this JSON schema, so JSON.parse below can't fail on shape (it can
          // still fail on an unreachable/erroring server, which throws first).
          format: NL_SEARCH_RESPONSE_FORMAT,
        }),
      });
      if (!response.ok) {
        throw new Error(`Ollama responded with ${response.status}`);
      }

      const data = (await response.json()) as OllamaChatResponse;
      const parsed = JSON.parse(data.message?.content ?? '');

      // sanitizeSelector is mandatory: parsed is untrusted model output and
      // must never reach QueryProviders unsanitized.
      selector = sanitizeSelector(parsed);
    } catch {
      throw new HttpError(502, 'could not process natural-language search');
    }

    // The LLM is never the source of coordinates (see prompt.ts); a bounding
    // box is only attached here, from a caller-supplied map center, exactly
    // like the deterministic /providers search.
    if (center) {
      Object.assign(selector, boundingBoxSelector(center));
    }

    const result = await withContract(identity, (contract) =>
      contract.evaluateTransaction('QueryProviders', JSON.stringify({ selector }))
    );
    let providers = JSON.parse(Buffer.from(result).toString('utf8')) as ChargingProviderResult[];

    if (center) {
      providers = providers.filter(
        (p) =>
          haversineKm(center.lat, center.lng, p.latitude / LAT_LNG_SCALE, p.longitude / LAT_LNG_SCALE) <=
          center.radiusKm
      );
    }

    res.json(providers);
  })
);
