/**
 * Whisper hallucination guard (VOICE_INPUT_ADDENDUM.md section 4). On
 * silence or noise, whisper.cpp emits confident stock phrases rather than an
 * empty string -- without this filter, a fumbled push-to-talk press produces
 * a real search for "Thank you." Treated the same way sanitizeSelector
 * treats a price of 0: a known bad input with a dedicated test, not an edge
 * case left to fail silently.
 */
const HALLUCINATIONS = new Set([
  'you',
  'thank you',
  'thanks for watching',
  'bye',
  'okay',
  'oh',
  // Periods are stripped by the normalization below before this Set is
  // checked, so entries must already be in that stripped form (a literal
  // "amara.org" here would never match "amaraorg" and silently defeat the
  // guard for this specific hallucination).
  'subtitles by the amaraorg community',
  'transcription by castingwords',
]);

/** Returns '' for silence/noise/hallucinated output; the caller must treat that as a 422, never as an empty search. */
export function cleanTranscript(raw: string): string {
  const t = raw.replace(/\[.*?\]|\(.*?\)/g, '').trim(); // strip [BLANK_AUDIO], (music)
  const norm = t.toLowerCase().replace(/[.!?,]/g, '').trim();
  if (norm.length < 3 || HALLUCINATIONS.has(norm)) return '';
  return t;
}
