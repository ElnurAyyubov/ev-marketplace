/**
 * POST /search/voice (VOICE_INPUT_ADDENDUM.md section 5). Read-only:
 * returns filters, never results -- it does not call QueryProviders. The
 * frontend populates the same Type/Price/Approval/Within-km controls the
 * manual filter UI and NL search already write to, then the user triggers
 * the existing GET /providers search themselves.
 *
 * radiusKm is a scalar only. Per CAR_LOCATION_ADDENDUM.md section 2.1/9,
 * it must never be attached to a server-side QueryProviders bounding box --
 * the frontend applies it to the marketplace's existing client-side
 * "within X km" filter instead, exactly like a manually-typed radius.
 *
 * Fail-closed, identical in spirit to NL_SEARCH_ADDENDUM.md section 4: no
 * error path here ever falls through to an unsanitized or unfiltered query,
 * because this endpoint never queries anything -- worst case it returns an
 * error and the frontend's existing filter state is untouched.
 */
import { Router } from 'express';
import multer from 'multer';
import { NL_SEARCH_RESPONSE_FORMAT, SYSTEM_PROMPT } from '../nlSearch/prompt';
import { sanitizeSelector } from '../nlSearch/sanitize';
import { cleanTranscript } from '../voice/cleanTranscript';
import { NEARBY_RADIUS_KM, parseVoiceFilters, VoiceFilters } from '../voice/parseFilters';
import { transcribe, WhisperUnreachableError } from '../voice/transcribe';
import { asyncHandler, HttpError, requireIdentity } from './util';

export const voiceRouter = Router();

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'qwen2.5:3b-instruct';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 4 * 1024 * 1024 } });

interface OllamaChatResponse {
  message?: { content?: string };
}

interface VoiceSearchResponse {
  transcript: string;
  filters: VoiceFilters;
  source: 'rules' | 'llm';
  nearbyApplied: boolean;
}

/**
 * Fallback only, invoked when the deterministic parser matched zero fields.
 * Reuses NL_SEARCH_ADDENDUM's existing prompt/constrained-decoding schema
 * unchanged -- sanitizeSelector() is still the mandatory boundary between
 * this untrusted model output and the response sent to the frontend.
 * minPricePerkWh is deliberately dropped: out of scope for the voice path
 * (VOICE_INPUT_ADDENDUM.md section 7).
 */
async function parseWithLlm(transcript: string): Promise<{ filters: VoiceFilters; nearbyApplied: boolean }> {
  const response = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      stream: false,
      options: { temperature: 0, seed: 42 },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: transcript },
      ],
      format: NL_SEARCH_RESPONSE_FORMAT,
    }),
  });
  if (!response.ok) throw new Error(`Ollama responded with ${response.status}`);

  const data = (await response.json()) as OllamaChatResponse;
  const parsed = JSON.parse(data.message?.content ?? '');
  const selector = sanitizeSelector(parsed);

  const filters: VoiceFilters = {
    providerType: selector.providerType,
    approvalRequired: selector.approvalRequired,
    maxPricePerkWh: selector.pricePerkWh?.$lte,
  };
  const matched = Object.values(filters).filter((v) => v !== undefined).length;
  const nearbyApplied = matched > 0;
  if (nearbyApplied) filters.radiusKm = NEARBY_RADIUS_KM;

  return { filters, nearbyApplied };
}

voiceRouter.post(
  '/search/voice',
  upload.single('audio'),
  asyncHandler(async (req, res) => {
    requireIdentity(req);
    if (!req.file || req.file.size === 0) {
      throw new HttpError(400, 'audio is required');
    }

    let transcript: string;
    try {
      transcript = await transcribe(req.file.buffer);
    } catch (err) {
      if (err instanceof WhisperUnreachableError) {
        throw new HttpError(502, 'whisper-server unreachable');
      }
      throw new HttpError(400, 'malformed audio upload');
    }

    if (!cleanTranscript(transcript)) {
      throw new HttpError(422, 'no speech detected');
    }

    const rules = parseVoiceFilters(transcript);
    let body: VoiceSearchResponse;

    if (rules.matched > 0) {
      body = { transcript, filters: rules.filters, source: 'rules', nearbyApplied: rules.nearbyApplied };
    } else {
      try {
        const llm = await parseWithLlm(transcript);
        body = { transcript, filters: llm.filters, source: 'llm', nearbyApplied: llm.nearbyApplied };
      } catch {
        throw new HttpError(502, 'could not process voice search');
      }
    }

    res.json(body);
  })
);
