import { Router } from 'express';
import { NL_SEARCH_RESPONSE_FORMAT, SYSTEM_PROMPT } from '../nlSearch/prompt';
import { sanitizeSelector } from '../nlSearch/sanitize';
import { asyncHandler, HttpError, requireIdentity } from './util';

export const nlSearchRouter = Router();

// Local-only: this endpoint never calls a hosted LLM API. See gateway/README.md
// "Natural-language search" section for setup and the model-provenance note.
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'qwen2.5:3b-instruct';

interface OllamaChatResponse {
  message?: { content?: string };
}

// This endpoint only translates English into filter values matching the
// marketplace page's own filter inputs (type/min price/max price/approval)
// — it never queries the ledger itself. The frontend populates its filter
// inputs from this response and runs the existing, deterministic
// GET /providers search to fetch results.
interface NlFilters {
  type?: 'Commercial' | 'Residential';
  minPrice?: number;
  maxPrice?: number;
  approvalRequired?: boolean;
}

nlSearchRouter.post(
  '/search/nl',
  asyncHandler(async (req, res) => {
    requireIdentity(req);
    const { query } = (req.body ?? {}) as { query?: string };
    if (typeof query !== 'string' || !query.trim()) {
      throw new HttpError(400, 'query is required');
    }

    let filters: NlFilters;
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
      // must never reach the frontend unsanitized.
      const selector = sanitizeSelector(parsed);
      filters = {
        type: selector.providerType,
        approvalRequired: selector.approvalRequired,
        minPrice: selector.pricePerkWh?.$gte,
        maxPrice: selector.pricePerkWh?.$lte,
      };
    } catch {
      throw new HttpError(502, 'could not process natural-language search');
    }

    res.json({ filters });
  })
);
