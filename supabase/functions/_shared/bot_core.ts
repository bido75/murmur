// Meeting bot calls shared by the bot function and the scheduler (automatic notetaker).
import { adminClient, HttpError } from './services.ts';
import { apiBase, botAnnouncement, createBotBody, recallEnv, type RecallEnv } from './recall.ts';

export function env(): RecallEnv {
  const e = recallEnv((k) => Deno.env.get(k));
  if (!e.apiKey) throw new HttpError(503, "The meeting bot isn't set up on the server yet (RECALL_API_KEY).");
  return e;
}

export async function recall<T>(e: RecallEnv, path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${apiBase(e)}${path}`, {
    ...init,
    headers: { Authorization: `Token ${e.apiKey}`, 'Content-Type': 'application/json', Accept: 'application/json', ...(init.headers ?? {}) },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Meeting bot service error (${res.status}): ${text.slice(0, 200)}`);
  return (text ? JSON.parse(text) : {}) as T;
}


/** Ask Recall for a bot and remember it. The recording row must already exist. */
export async function createBot(o: { userId: string; email: string | null; recordingId: string; meetingUrl: string; joinAt: string | null; eventKey?: string | null; eventStart?: string | null }) {
  const e = env();
  const bot = await recall<{ id: string }>(e, '/bot/', {
    method: 'POST',
    body: JSON.stringify(
      createBotBody({
        meetingUrl: o.meetingUrl,
        joinAt: o.joinAt,
        botName: e.botName,
        recordingId: o.recordingId,
        userId: o.userId,
        announcement: botAnnouncement(o.email, Deno.env.get('APP_NAME') ?? 'Murmur'),
      }),
    ),
  });
  const { error } = await adminClient().from('meeting_bots').insert({
    user_id: o.userId,
    recording_id: o.recordingId,
    provider_bot_id: bot.id,
    meeting_url: o.meetingUrl,
    join_at: o.joinAt,
    event_key: o.eventKey ?? null,
    event_start: o.eventStart ?? null,
  });
  if (error) throw new Error(error.message);
  return bot.id;
}
