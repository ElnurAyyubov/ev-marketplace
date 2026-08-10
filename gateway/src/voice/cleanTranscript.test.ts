import { describe, expect, it } from 'vitest';
import { cleanTranscript } from './cleanTranscript';

describe('cleanTranscript', () => {
  it('passes through a real utterance unchanged (modulo trim)', () => {
    expect(cleanTranscript('  residential chargers under thirty  ')).toBe(
      'residential chargers under thirty'
    );
  });

  it('rejects the classic whisper silence hallucination "Thank you."', () => {
    expect(cleanTranscript('Thank you.')).toBe('');
  });

  it('rejects known stock hallucinations regardless of case/punctuation', () => {
    expect(cleanTranscript('You')).toBe('');
    expect(cleanTranscript('Okay.')).toBe('');
    expect(cleanTranscript('Bye!')).toBe('');
    expect(cleanTranscript('Thanks for watching!')).toBe('');
    expect(cleanTranscript('Subtitles by the Amara.org community')).toBe('');
  });

  it('strips [BLANK_AUDIO] and (music) markers, then rejects if nothing real is left', () => {
    expect(cleanTranscript('[BLANK_AUDIO]')).toBe('');
    expect(cleanTranscript('(music)')).toBe('');
  });

  it('rejects near-empty transcripts under the length floor', () => {
    expect(cleanTranscript('ok')).toBe('');
    expect(cleanTranscript('')).toBe('');
    expect(cleanTranscript('   ')).toBe('');
  });

  it('does not reject a short but real utterance at the length floor', () => {
    expect(cleanTranscript('no fee')).toBe('no fee');
  });
});
