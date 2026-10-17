// Uploads from linked devices (browser extension, watches, desktop screen recording) and
// transcripts made on the phone. Pure; tested.

export type Utterance = { start_ms: number; end_ms: number; speaker: number; text: string };

const TYPES: Record<string, { ext: string; video: boolean }> = {
  'audio/webm': { ext: 'webm', video: false },
  'audio/ogg': { ext: 'ogg', video: false },
  'audio/mp4': { ext: 'm4a', video: false },
  'audio/x-m4a': { ext: 'm4a', video: false },
  'audio/m4a': { ext: 'm4a', video: false },
  'audio/aac': { ext: 'aac', video: false },
  'audio/mpeg': { ext: 'mp3', video: false },
  'audio/wav': { ext: 'wav', video: false },
  'audio/x-wav': { ext: 'wav', video: false },
  'video/webm': { ext: 'webm', video: true },
  'video/mp4': { ext: 'mp4', video: true },
};

/** Normalised content type and file extension, or null if it isn't audio/video we accept. */
export function uploadType(contentType: string | null | undefined): { type: string; ext: string; video: boolean } | null {
  const t = String(contentType ?? '').split(';')[0].trim().toLowerCase();
  const hit = TYPES[t];
  return hit ? { type: t, ...hit } : null;
}

export function segmentPath(userId: string, recordingId: string, idx: number, ext: string): string {
  return `${userId}/${recordingId}/seg-${String(idx).padStart(4, '0')}.${ext}`;
}

export const DEVICE_SOURCES = { extension: 'extension', watch: 'watch', wear: 'watch', desktop: 'screen', other: 'mic' } as const;

/** A transcript sent from the phone: kept only if it is well-formed, in order and a sane size. */
export function cleanLocalTranscript(raw: unknown): Utterance[] | null {
  if (!Array.isArray(raw) || !raw.length || raw.length > 20_000) return null;
  const out: Utterance[] = [];
  let total = 0;
  let last = 0;
  for (const x of raw) {
    const u = x as Record<string, unknown>;
    const start = Math.round(Number(u.start_ms));
    const end = Math.round(Number(u.end_ms));
    const text = String(u.text ?? '').replace(/\s+/g, ' ').trim();
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start || start < last - 1000) return null;
    if (!text) continue;
    total += text.length;
    if (total > 2_000_000) return null;
    out.push({ start_ms: start, end_ms: end, speaker: Math.max(0, Math.min(20, Math.round(Number(u.speaker) || 0))), text: text.slice(0, 5000) });
    last = start;
  }
  return out.length ? out : null;
}

/**
 * whisper.cpp segments (t0/t1 in 10 ms units) → utterances. Whisper has no speaker labels, so a
 * long pause (default 1.5 s) starts a new paragraph; everything is speaker 0.
 */
export function whisperToUtterances(segments: { text: string; t0: number; t1: number }[], offsetMs = 0, gapMs = 1500): Utterance[] {
  const out: Utterance[] = [];
  for (const s of segments) {
    const text = s.text.replace(/\[[^\]]*\]|\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim(); // drop [MUSIC], (laughs)
    if (!text) continue;
    const start = offsetMs + s.t0 * 10;
    const end = offsetMs + s.t1 * 10;
    const prev = out[out.length - 1];
    if (prev && start - prev.end_ms < gapMs && prev.text.length < 600) {
      prev.text = `${prev.text} ${text}`;
      prev.end_ms = end;
    } else out.push({ start_ms: start, end_ms: end, speaker: 0, text });
  }
  return out;
}

/** A 44-byte WAV header for 16-bit PCM (what whisper.cpp reads). */
export function wavHeader(dataBytes: number, sampleRate = 16000, channels = 1): Uint8Array {
  const h = new Uint8Array(44);
  const v = new DataView(h.buffer);
  const ascii = (o: number, s: string) => [...s].forEach((c, i) => (h[o + i] = c.charCodeAt(0)));
  ascii(0, 'RIFF');
  v.setUint32(4, 36 + dataBytes, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  v.setUint32(16, 16, true); // PCM chunk size
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, channels, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * channels * 2, true); // byte rate
  v.setUint16(32, channels * 2, true); // block align
  v.setUint16(34, 16, true); // bits per sample
  ascii(36, 'data');
  v.setUint32(40, dataBytes, true);
  return h;
}

/** Loudness of a chunk of 16-bit little-endian PCM, in dBFS (−160 for silence). */
export function pcmLevelDb(bytes: Uint8Array): number {
  const n = Math.floor(bytes.length / 2);
  if (!n) return -160;
  const v = new DataView(bytes.buffer, bytes.byteOffset, n * 2);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const s = v.getInt16(i * 2, true) / 32768;
    sum += s * s;
  }
  const rms = Math.sqrt(sum / n);
  return rms > 0 ? Math.max(-160, 20 * Math.log10(rms)) : -160;
}

/**
 * When a photo was taken, from its EXIF data ("2026:10:15 09:12:30", the camera's local time,
 * with an optional "-05:00" offset). Returns epoch ms, or null if missing or nonsense.
 */
export function exifTakenAt(exif: Record<string, unknown> | null | undefined, tzOffsetMin = new Date().getTimezoneOffset()): number | null {
  if (!exif) return null;
  const raw = String(exif.DateTimeOriginal ?? exif.DateTimeDigitized ?? exif.DateTime ?? (exif['{Exif}'] as Record<string, unknown> | undefined)?.DateTimeOriginal ?? '');
  const m = raw.match(/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (!m) return null;
  const [y, mo, d, h, mi, s] = m.slice(1).map(Number);
  if (y < 2000 || mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 60) return null;
  const off = String(exif.OffsetTimeOriginal ?? exif.OffsetTime ?? '').match(/^([+-])(\d{2}):?(\d{2})$/);
  // Offset given: exact. Otherwise assume the phone's own time zone (the photo was taken on it).
  const offsetMin = off ? -(off[1] === '-' ? -1 : 1) * (Number(off[2]) * 60 + Number(off[3])) : tzOffsetMin;
  return Date.UTC(y, mo - 1, d, h, mi, s) + offsetMin * 60_000;
}

/** Where in the recording a library photo belongs, if it was taken while recording (±1 min). */
export function photoMoment(takenAt: number | null, recordingStart: string, durationMs: number): number | null {
  if (takenAt == null) return null;
  const ms = takenAt - Date.parse(recordingStart);
  if (!Number.isFinite(ms) || ms < -60_000 || ms > durationMs + 60_000) return null;
  return Math.max(0, Math.min(ms, durationMs));
}
