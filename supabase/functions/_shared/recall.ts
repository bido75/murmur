// Optional meeting bot via Recall.ai (a bot-as-a-service that joins Zoom, Meet, Teams and Webex).
// Request building and webhook verification are pure and unit-tested; the live API still needs
// a run with a Recall.ai account.
import { detectMeetingLink } from './calendar.ts';

export type RecallEnv = { apiKey: string; region: string; webhookSecret: string; botName: string; publicApiBaseUrl: string };

export function recallEnv(get: (k: string) => string | undefined): RecallEnv {
  return {
    apiKey: get('RECALL_API_KEY') ?? '',
    region: get('RECALL_REGION') ?? 'us-west-2',
    // The workspace verification secret, which is what Recall signs its dashboard
    // webhooks with. The name follows Recall's own guidance so it is clear which
    // secret belongs to which side.
    webhookSecret: get('RECALL_WEBHOOK_VERIFICATION_SECRET') ?? '',
    botName: get('BOT_NAME') ?? 'Murmur Notetaker',
    // The public address of this server. Recall can only reach a stable https URL, so
    // a local address is never sent to it.
    publicApiBaseUrl: (get('PUBLIC_API_BASE_URL') ?? '').replace(/\/$/, ''),
  };
}

export const apiBase = (e: RecallEnv) => `https://${e.region}.recall.ai/api/v1`;

/** Where Recall sends the bot's status events. */
export function botWebhookUrl(e: RecallEnv): string {
  return `${e.publicApiBaseUrl}/functions/v1/bot/webhook`;
}

/**
 * When the bot gives up on a call. A notetaker that cannot get in, or that sits in an
 * empty room, costs everyone, so these are the timeouts from Recall's own defaults,
 * with one exception: the recording is left to run for as long as the meeting lasts.
 */
const automaticLeave = {
  // Not let in within ten minutes: leave the waiting room.
  waiting_room_timeout: 600,
  // In the call but nobody else came: leave.
  noone_joined_timeout: 600,
  // Everyone else left: leave half a minute later.
  everyone_left_timeout: { timeout: 30 },
  // The host said no: leave.
  recording_permission_denied_timeout: 30,
  // In the call but not recording for half an hour: leave.
  in_call_not_recording_timeout: 1800,
  // Only other bots are left in the room: leave.
  bot_detection: {
    using_participant_names: { matches: ['notetaker', 'recorder', 'assistant'], timeout: 600, activate_after: 120 },
  },
};

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
}, now = Date.now()) {
  const body: Record<string, unknown> = {
    meeting_url: o.meetingUrl,
    bot_name: o.botName.slice(0, 100),
    // IDs at the top level so the bot can be found even without a recording.
    metadata: { recording_id: o.recordingId, user_id: o.userId },
    recording_config: { audio_mixed_mp3: {} },
    chat: { on_bot_join: { send_to: 'everyone', message: o.announcement.slice(0, 500) } },
    automatic_leave: automaticLeave,
  };
  // Every bot goes through the scheduling path, even one that joins straight away, so it
  // can be cancelled before it joins. A meeting that starts too soon for a held bot is
  // joined as soon as it can be; the caller decides that with scheduledInTime.
  const at = o.joinAt ? new Date(o.joinAt).getTime() : NaN;
  body.join_at = new Date(Number.isFinite(at) && at > now ? at : now + 60_000).toISOString();
  return body;
}

/**
 * Should a failed request be tried again, and how long to wait first.
 *
 * Recall asks for no more than 120 bot creations a minute, and the pool of bots for
 * meetings that start now is sometimes empty (507) or the service is briefly busy
 * (503). Those are worth another try. Anything else is a real answer.
 */
export function retryPlan(
  status: number,
  attempt: number,
  retryAfter: string | null,
  now = Date.now(),
  random: () => number = Math.random,
): { retry: boolean; waitMs: number } {
  if (![429, 503, 507].includes(status)) return { retry: false, waitMs: 0 };
  const header = (retryAfter ?? '').trim();
  // Retry-After is either a number of seconds or a date. The number is checked first,
  // because a date parser reads "12" as the year 12 rather than twelve seconds.
  if (/^\d+$/.test(header)) return { retry: true, waitMs: Number(header) * 1000 };
  const asDate = header ? Date.parse(header) : NaN;
  if (Number.isFinite(asDate)) return { retry: true, waitMs: Math.max(0, asDate - now) };
  // No hint: wait longer each time, with a little jitter so many bots do not all
  // come back at the same moment.
  const wait = Math.min(30_000, 1000 * 2 ** attempt) + Math.floor(random() * 500);
  return { retry: true, waitMs: wait };
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

/** The bot events this app acts on. The webhook endpoint is subscribed to these. */
export const BOT_EVENTS = [
  'bot.joining_call',
  'bot.in_waiting_room',
  'bot.in_call_not_recording',
  'bot.recording_permission_denied',
  'bot.in_call_recording',
  'bot.call_ended',
  'bot.done',
  'bot.fatal',
];

/** True when the notes for a recording have already been made, so a repeated event must not make them again. */
export function alreadyCollected(recordingStatus: string | null): boolean {
  return recordingStatus === 'ready' || recordingStatus === 'summarizing' || recordingStatus === 'transcribing';
}

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
