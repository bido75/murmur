// Mistral's speech-to-text, and the rule for when it may be used instead of Deepgram.
//
// Pure: no network and no environment, so the mapping and the rule can be tested
// without either. The call itself is in services.ts.
//
// The answer Mistral gives is not the same shape as Deepgram's, and the parts that
// differ are the parts this file is for.

import type { Utterance } from './verify.ts';

/** The engines the server can read audio with. */
export type SttProvider = 'deepgram' | 'mistral';

export type MistralSegment = {
  text?: string;
  /** Seconds from the start of the audio. */
  start?: number;
  end?: number;
  /** "speaker_1" is the first speaker, or null when speakers were not asked for. */
  speaker_id?: string | null;
};

export type MistralAnswer = {
  text?: string;
  language?: string | null;
  segments?: MistralSegment[];
  usage?: { prompt_audio_seconds?: number };
};

/** "speaker_1" is the first speaker, so it becomes 0. */
export function speakerNumber(id: string | null | undefined): number {
  const digits = String(id ?? '').replace(/\D+/g, '');
  const n = Number(digits);
  return Number.isFinite(n) && n > 0 ? n - 1 : 0;
}

/**
 * Which engine reads the audio.
 *
 * Mistral cannot redact. A redaction is a promise that personal details were taken
 * out of the transcript, so when one is asked for and this engine cannot keep it,
 * Deepgram is used instead. Dropping it silently is not an option.
 */
export function chooseSttProvider(asked: string | undefined, wantsRedaction: boolean): SttProvider {
  const wanted = (asked ?? '').trim().toLowerCase();
  if (wanted !== 'mistral') return 'deepgram';
  return wantsRedaction ? 'deepgram' : 'mistral';
}

/**
 * An answer from Mistral as utterances, with the times in milliseconds like
 * everywhere else.
 *
 * Mistral splits the audio into segments of its own accord. When it returns none —
 * it does that when segment granularity was not honoured — the whole text is kept as
 * one utterance rather than thrown away.
 */
export function mistralUtterances(answer: MistralAnswer): {
  utterances: Utterance[];
  durationMs: number;
  language: string | null;
} {
  const segments = (answer.segments ?? []).filter((s) => (s.text ?? '').trim());
  let utterances: Utterance[];
  if (segments.length) {
    utterances = segments.map((s) => ({
      start_ms: Math.max(0, Math.round((s.start ?? 0) * 1000)),
      end_ms: Math.max(0, Math.round((s.end ?? s.start ?? 0) * 1000)),
      speaker: speakerNumber(s.speaker_id),
      text: (s.text ?? '').trim(),
    }));
  } else {
    const whole = (answer.text ?? '').trim();
    utterances = whole ? [{ start_ms: 0, end_ms: 0, speaker: 0, text: whole }] : [];
  }

  const fromSegments = utterances.reduce((max, u) => Math.max(max, u.end_ms), 0);
  const fromUsage = Math.round((answer.usage?.prompt_audio_seconds ?? 0) * 1000);
  const durationMs = Math.max(fromSegments, fromUsage);

  // A single utterance with no times gets the whole recording, so the parts that
  // line the transcript up with the audio still work.
  if (utterances.length === 1 && utterances[0].end_ms === 0 && durationMs > 0) {
    utterances[0] = { ...utterances[0], end_ms: durationMs };
  }

  return { utterances, durationMs, language: answer.language ?? null };
}
