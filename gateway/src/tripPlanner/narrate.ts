/**
 * Structured TripPlan -> prose (TRIP_PLANNER_ADDENDUM.md §8). The model is
 * handed an already-decided plan and only rewrites it as text; it decides
 * nothing. Callers must treat any failure here as non-fatal and omit
 * narration rather than fail the request -- narration is never a dependency
 * of the feature working.
 */
import { TripPlan } from './types';

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'qwen2.5:3b-instruct';

const NARRATION_SYSTEM_PROMPT = `You narrate an already-decided EV charging trip plan as 1-3 short, friendly sentences of prose. You are given the finished plan as JSON -- do not invent stations, prices, distances, or alternatives beyond what's in the JSON. Do not suggest changes to the route. If status is "no_feasible_route", say so plainly and mention the reason.`;

interface OllamaChatResponse {
  message?: { content?: string };
}

/** Throws on any failure; callers must catch and omit narration (never fail the request on this). */
export async function narrateTripPlan(plan: TripPlan): Promise<string> {
  const response = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      stream: false,
      options: { temperature: 0, seed: 42 },
      messages: [
        { role: 'system', content: NARRATION_SYSTEM_PROMPT },
        { role: 'user', content: JSON.stringify(plan) },
      ],
    }),
  });
  if (!response.ok) throw new Error(`Ollama request failed with status ${response.status}`);

  const data = (await response.json()) as OllamaChatResponse;
  const text = data.message?.content?.trim();
  if (!text) throw new Error('empty narration');
  return text;
}
