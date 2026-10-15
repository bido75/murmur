// Optional meeting bot via Recall.ai (a bot-as-a-service that joins Zoom, Meet, Teams and Webex).
// Request building and webhook verification are pure and unit-tested; the live API still needs
// a run with a Recall.ai account.
import { detectMeetingLink } from './calendar.ts';

export type RecallEnv = { apiKey: string; region: string; webhookSecret: string; botName: string };

export function recallEnv(get: (k: string) => string | undefined): RecallEnv {
  return {
    apiKey: get('RECALL_API_KEY') ?? '',
    region: get('RECALL_REGION') ?? 'us-west-2',
    webhookSecret: get('RECALL_WEBHOOK_SECRET') ?? '',
    botName: get('BOT_NAME') ?? 'Murmur Notetaker',
  };
}

export const apiBase = (e: RecallEnv) => `https://${e.region}.recall.ai/api/v1`;

/** Only real meeting links (Zoom, Meet, Teams, Webex); the bot can't join anything else. */
export function meetingPlatform(url: string): 'zoom' | 'meet' | 'teams' | 'webex' | null {
  // The whole input must be the meeting link (not a link hidden inside another URL).
  const found = detectMeetingLink(url.trim());
  return found && found.url === url.trim() ? found.platform : null;
}

/** The bot announces itself by name and in the meeting chat, so nobody is recorded unawares. */
export function botAnnouncement(organizer: string | null, appName: string): string {
  return `Hi, I'm a notetaker recording this meeting${organizer ? ` for ${organizer}` : ''} with ${appName}. The notes and transcript go to them. If you don't want to be recorded, tell the host or remove me from the call.`;
}

export function createBotBody(o: {
  meetingUrl: string;
  joinAt: string | null;
  botName: string;
  recordingId: string;
  userId: string;
  announcement: string;
}) {
  const body: Record<string, unknown> = {
    meeting_url: o.meetingUrl,
    bot_name: o.botName.slice(0, 100),
    // IDs at the top level so the bot can be found even without a recording.
    metadata: { recording_id: o.recordingId, user_id: o.userId },
    recording_config: { audio_mixed_mp3: {} },
    chat: { on_bot_join: { send_to: 'everyone', message: o.announcement.slice(0, 500) } },
  };
  // Scheduling ahead avoids last-minute capacity errors; join_at must be in the future.
  if (o.joinAt && new Date(o.joinAt).getTime() > Date.now() + 60_000) body.join_at = new Date(o.joinAt).toISOString();
  return body;
}

// ---------- Webhook verification (webhook-* or legacy svix-* headers, HMAC-SHA256) ----------

function b64decode(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function b64encode(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

export async function signWebhook(secret: string, id: string, timestamp: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', b64decode(secret.replace(/^whsec_/, '')) as BufferSource, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${id}.${timestamp}.${body}`)));
  return b64encode(sig);
}

/** Throws unless the request was signed by Recall with our secret within the last 5 minutes. */
export async function verifyWebhook(headers: Headers, body: string, secret: string, now = Date.now()): Promise<void> {
  if (!secret.startsWith('whsec_')) throw new Error('Webhook secret is not configured');
  const id = headers.get('webhook-id') ?? headers.get('svix-id');
  const ts = headers.get('webhook-timestamp') ?? headers.get('svix-timestamp');
  const sigs = headers.get('webhook-signature') ?? headers.get('svix-signature');
  if (!id || !ts || !sigs) throw new Error('Missing signature headers');
  const t = Number(ts) * 1000;
  if (!Number.isFinite(t) || Math.abs(now - t) > 5 * 60_000) throw new Error('Stale webhook');
  const expected = await signWebhook(secret, id, ts, body);
  for (const part of sigs.split(' ')) {
    const [version, sig] = part.split(',');
    if (version === 'v1' && sig && safeEqual(sig, expected)) return;
  }
  throw new Error('Bad signature');
}

// ---------- Events and media ----------

export type BotEvent = { event: string; botId: string | null; recordingId: string | null; code: string | null; subCode: string | null };

export function parseBotEvent(payload: unknown): BotEvent {
  const p = payload as { event?: string; data?: { bot?: { id?: string; metadata?: Record<string, string> }; data?: { code?: string; sub_code?: string | null } } };
  return {
    event: String(p?.event ?? ''),
    botId: p?.data?.bot?.id ?? null,
    recordingId: p?.data?.bot?.metadata?.recording_id ?? null,
    code: p?.data?.data?.code ?? null,
    subCode: p?.data?.data?.sub_code ?? null,
  };
}

/** Our status for a bot event, and what to show the user. */
export function statusForEvent(e: BotEvent): { status: string; detail: string | null } | null {
  switch (e.event) {
    case 'bot.joining_call': return { status: 'joining', detail: null };
    case 'bot.in_waiting_room': return { status: 'waiting_room', detail: 'Waiting to be let in' };
    case 'bot.in_call_not_recording': return { status: 'in_call', detail: 'In the call, not recording yet' };
    case 'bot.recording_permission_denied': return { status: 'denied', detail: 'The host didn’t allow recording' };
    case 'bot.in_call_recording': return { status: 'recording', detail: null };
    case 'bot.call_ended': return { status: 'call_ended', detail: null };
    case 'bot.done': return { status: 'done', detail: null };
    case 'bot.fatal': return { status: 'failed', detail: e.subCode ? `Bot couldn’t record (${e.subCode})` : 'Bot couldn’t record' };
    default: return null;
  }
}

/** The mixed-audio download link from a bot and its audio_mixed listing, if ready. */
export function audioDownloadUrl(bot: unknown, audioMixed: unknown): string | null {
  const list = (audioMixed as { results?: { status?: { code?: string }; data?: { download_url?: string } }[] })?.results ?? [];
  const ready = list.find((r) => r?.data?.download_url && (!r.status?.code || r.status.code === 'done'));
  if (ready) return ready.data!.download_url!;
  // Fallback: the mixed video (the transcriber reads the audio track).
  const rec = (bot as { recordings?: { media_shortcuts?: { video_mixed?: { data?: { download_url?: string } } } }[] })?.recordings?.[0];
  return rec?.media_shortcuts?.video_mixed?.data?.download_url ?? null;
}

export function firstRecordingId(bot: unknown): string | null {
  return (bot as { recordings?: { id?: string }[] })?.recordings?.[0]?.id ?? null;
}
