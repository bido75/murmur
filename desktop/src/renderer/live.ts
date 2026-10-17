// Live transcript in the desktop app: streams the mixed mic + computer audio to Deepgram with a
// 60-second token from the server. Display only; the saved transcript comes from the pipeline.
import { supabase } from './supabase';

export type LiveLine = { text: string; final: boolean };

export function mergeLive(lines: LiveLine[], text: string, isFinal: boolean, max = 8): LiveLine[] {
  if (!text.trim()) return lines;
  const kept = lines.length && !lines[lines.length - 1].final ? lines.slice(0, -1) : lines;
  return [...kept, { text: text.trim(), final: isFinal }].slice(-max);
}

export async function startLive(stream: MediaStream, onLines: (l: LiveLine[]) => void, onError: (m: string) => void): Promise<() => void> {
  let stopped = false;
  let lines: LiveLine[] = [];
  let ws: WebSocket | null = null;
  let rec: MediaRecorder | null = null;
  const stop = () => {
    stopped = true;
    try { if (rec && rec.state !== 'inactive') rec.stop(); } catch { /* already stopped */ }
    try {
      if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'CloseStream' }));
      ws?.close();
    } catch { /* closed */ }
  };
  try {
    const { data, error } = await supabase.functions.invoke('live/token', { body: {} });
    if (error || !data?.token) throw new Error('Live transcript is unavailable right now.');
    if (stopped) return stop;
    ws = new WebSocket(data.url, ['bearer', data.token]);
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(String(ev.data));
        lines = mergeLive(lines, msg?.channel?.alternatives?.[0]?.transcript ?? '', Boolean(msg?.is_final));
        onLines(lines);
      } catch { /* ignore non-transcript messages */ }
    };
    ws.onerror = () => { if (!stopped) onError('Live transcript disconnected. Your recording continues.'); };
    ws.onopen = () => {
      rec = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
      rec.ondataavailable = (e) => { if (e.data.size && ws?.readyState === WebSocket.OPEN) ws.send(e.data); };
      rec.start(250);
    };
  } catch (e) {
    stop();
    onError((e as Error).message);
  }
  return stop;
}
