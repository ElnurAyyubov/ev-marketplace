/**
 * Local ASR call (VOICE_INPUT_ADDENDUM.md section 4). whisper.cpp runs as a
 * resident local HTTP server, same deployment shape as Ollama -- see
 * gateway/README.md "Voice search" for how to build/run whisper-server.
 * This module never talks to a hosted ASR API and adds zero network egress.
 */
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cleanTranscript } from './cleanTranscript';

// 'localhost', not the '127.0.0.1' IP literal: the self-provisioning
// container path (docker-compose.example.yml) remaps the *hostname*
// "localhost" to the host machine via `extra_hosts: - "localhost:host-gateway"`
// (the same trick PEER_ENDPOINT/CA_ENDPOINT already rely on) so the
// container can reach a whisper-server running on the host. An IP literal
// bypasses that remap entirely and always means "this container itself".
const WHISPER_URL = process.env.WHISPER_URL ?? 'http://localhost:8080';
const MAX_SECONDS = Number(process.env.VOICE_MAX_SECONDS ?? 15);

export class WhisperUnreachableError extends Error {}

/** Transcodes to 16kHz mono PCM, posts to whisper-server, and runs the hallucination guard. Returns '' for silence/noise -- callers must treat that as a 422, not an empty search. */
export async function transcribe(audio: Buffer): Promise<string> {
  const wav = join(tmpdir(), `${randomUUID()}.wav`);
  try {
    await transcode(audio, wav);
    const form = new FormData();
    form.append('file', new Blob([await readFile(wav)]), 'clip.wav');
    form.append('response_format', 'json');
    form.append('temperature', '0.0');
    form.append('no_speech_thold', '0.6');
    form.append('language', 'en');

    let r: Response;
    try {
      r = await fetch(`${WHISPER_URL}/inference`, { method: 'POST', body: form });
    } catch (err) {
      throw new WhisperUnreachableError((err as Error).message);
    }
    if (!r.ok) throw new WhisperUnreachableError(`whisper-server ${r.status}`);
    const { text } = (await r.json()) as { text?: string };
    return cleanTranscript(text ?? '');
  } finally {
    await unlink(wav).catch(() => {});
  }
}

function transcode(input: Buffer, outPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const ff = spawn('ffmpeg', [
      '-hide_banner', '-loglevel', 'error',
      '-i', 'pipe:0',
      '-t', String(MAX_SECONDS), // hard cap on clip length
      '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', // whisper requires 16 kHz mono PCM
      '-y', outPath,
    ]);
    ff.on('error', reject);
    ff.on('close', (c) => (c === 0 ? resolve() : reject(new Error(`ffmpeg exited ${c}`))));
    ff.stdin.on('error', () => {}); // swallow EPIPE if ffmpeg dies early
    ff.stdin.end(input);
  });
}
