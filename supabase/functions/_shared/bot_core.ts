// Meeting bot calls shared by the bot function and the scheduler (automatic notetaker).
import { adminClient, HttpError } from './services.ts';
import { apiBase, botAnnouncement, createBotBody, recallEnv, retryPlan, type RecallEnv } from './recall.ts';

export function env(): RecallEnv {
  const e = recallEnv((k) => Deno.env.get(k));
  if (!e.apiKey) throw new HttpError(503, "The meeting bot isn't set up on the server yet (RECALL_API_KEY).");
  return e;
}

/** How many times a request that failed in a temporary way is tried again. */
const MAX_ATTEMPTS = 3;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function recall<T>(e: RecallEnv, path: string, init: RequestInit = {}): Promise<T> {
  let last = '';
  let lastStatus = 0;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const res = await fetch(`${apiBase(e)}${path}`, {
      ...init,
      headers: { Authorization: `Token ${e.apiKey}`, 'Content-Type': 'application/json', Accept: 'application/json', ...(init.headers ?? {}) },
    });
    const text = await res.text();
    if (res.ok) return (text ? JSON.parse(text) : {}) as T;
    last = text;
    lastStatus = res.status;
    // A busy service, a rate limit or an empty pool of bots: worth trying again.
    const plan = retryPlan(res.status, attempt, res.headers.get('retry-after'));
    if (!plan.retry) break;
    await sleep(plan.waitMs);
  }
  // 507 means the pool of bots for meetings that start now was empty. It fills up again
  // every few minutes, so this is a "try again in a minute" rather than a failure.
  if (lastStatus === 507) {
    throw new HttpError(503, 'No notetaker was free to join just then. Try again in a minute, or schedule it at least ten minutes ahead.');
  }
  throw new Error(`Meeting bot service error (${lastStatus}): ${last.slice(0, 200)}`);
}

/**
 * Ask Recall for a bot and remember it. The recording row must already exist.
 *
 * If Recall gives us a bot but we cannot write it down, the bot is removed again:
 * a bot that records a meeting nobody can reach is worse than no bot at all.
 */
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
  if (error) {
    // Put the bot back so nothing records a meeting we have no notes for.
    await recall(e, `/bot/${bot.id}/`, { method: 'DELETE' }).catch(() => undefined);
    throw new Error(error.message);
  }
  return bot.id;
}
