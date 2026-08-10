import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import { Identity, VoiceSearchResult } from '../api/types';

type RecState = 'idle' | 'recording' | 'transcribing';

/**
 * Push-to-talk mic button for the marketplace filter controls
 * (VOICE_INPUT_ADDENDUM.md section 6). Toggle, not press-and-hold -- tap to
 * start, tap to stop. Read-only by construction: this component only ever
 * calls POST /search/voice (which returns filters, never results) and hands
 * the parsed result to the caller; it never triggers a search or a write
 * itself.
 *
 * getUserMedia needs a secure context (HTTPS or localhost) -- on an insecure
 * origin (e.g. a container opened by IP) it would throw, so the button
 * hides itself outright rather than rendering something that can't work.
 */
export function VoiceFilterButton({
  identity,
  onResult,
  onError,
}: {
  identity: Identity;
  onResult: (result: VoiceSearchResult) => void;
  onError: (message: string) => void;
}) {
  const [state, setState] = useState<RecState>('idle');
  const [elapsedSec, setElapsedSec] = useState(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(
    () => () => {
      // Unmount mid-recording (e.g. tab switch): release the mic rather than
      // leaving the browser's recording indicator on.
      streamRef.current?.getTracks().forEach((t) => t.stop());
      if (timerRef.current) clearInterval(timerRef.current);
    },
    []
  );

  if (typeof navigator === 'undefined' || !navigator.mediaDevices) {
    return null;
  }

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];
      const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.start();
      recorderRef.current = recorder;
      setElapsedSec(0);
      timerRef.current = setInterval(() => setElapsedSec((s) => s + 1), 1000);
      setState('recording');
    } catch {
      onError('Microphone permission denied or unavailable.');
    }
  };

  const stopRecording = () => {
    const recorder = recorderRef.current;
    if (!recorder) return;
    if (timerRef.current) clearInterval(timerRef.current);
    setState('transcribing');

    recorder.onstop = async () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      recorderRef.current = null;
      const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
      chunksRef.current = [];
      try {
        const result = await api.parseVoiceFilters(identity, blob);
        onResult(result);
      } catch (err) {
        onError((err as Error).message);
      } finally {
        setState('idle');
      }
    };
    recorder.stop();
  };

  const handleClick = () => {
    if (state === 'idle') startRecording();
    else if (state === 'recording') stopRecording();
    // 'transcribing': ignore clicks, never leave the button in an ambiguous state
  };

  const label =
    state === 'idle' ? '🎤 Speak filters' : state === 'recording' ? `● Recording ${elapsedSec}s (tap to stop)` : 'Transcribing…';

  return (
    <button
      type="button"
      className={state === 'recording' ? 'voice-btn voice-btn-recording' : 'voice-btn'}
      onClick={handleClick}
      disabled={state === 'transcribing'}
    >
      {label}
    </button>
  );
}
