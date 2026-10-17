// Live transcript while recording (web app; the desktop app has its own copy). Display only:
// the saved transcript still comes from the full pipeline after you stop.
import { supabase } from './supabase';

export type LiveLine = { text: string; final: boolean };

/** Merge one streaming result into the running list of lines. Pure; exported for tests. */
export function mergeLive(lines: LiveLine[], text: string, isFinal: boolean, max = 8): LiveLine[] {
  if (!text.trim()) return lines;
  const kept = lines.length && !lines[lines.length - 1].final ? lines.slice(0, -1) : lines;
  return [...kept, { text: text.trim(), final: isFinal }].slice(-max);
}

/**
 * Opens its own microphone stream and streams it to Deepgram with a 60-second token from our
 * server. Returns a stop function. Calls onError once if it can't start (the recording is unaffected).
 */
export async function startLive(onLines: (lines: LiveLine[]) => void, onError: (msg: string) => void): Promise<() => void> {
  let stopped = false;
  let lines: LiveLine[] = [];
  let ws: WebSocket | null = null;
  let rec: MediaRecorder | null = null;
  let stream: MediaStream | null = null;
  const stop = () => {
    stopped = true;
    try {
      rec?.state !== 'inactive' && rec?.stop();
    } catch {}
    stream?.getTracks().forEach((t) => t.stop());
    try {
      if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'CloseStream' }));
      ws?.close();
    } catch {}
  };
  try {
    const { data, error } = await supabase.functions.invoke('live/token', { body: {} });
    if (error || !data?.token) throw new Error('Live transcript is unavailable right now.');
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    if (stopped) return stop;
    ws = new WebSocket(data.url, ['bearer', data.token]);
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(String(ev.data));
        const text = msg?.channel?.alternatives?.[0]?.transcript ?? '';
        lines = mergeLive(lines, text, Boolean(msg?.is_final));
        onLines(lines);
      } catch {}
    };
    ws.onerror = () => !stopped && onError('Live transcript disconnected. Your recording continues.');
    ws.onopen = () => {
      if (!stream) return;
      rec = new MediaRecorder(stream, { mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : undefined });
      rec.ondataavailable = (e) => e.data.size && ws?.readyState === WebSocket.OPEN && ws.send(e.data);
      rec.start(250);
    };
  } catch (e) {
    stop();
    onError((e as Error).message);
  }
  return stop;
}
