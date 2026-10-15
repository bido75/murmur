// Attendee consent links. Deploy with --no-verify-jwt: attendees aren't signed in; the token is the key.
//   GET  /consent?token=…                          → what the meeting is and who is recording
//   POST /consent { token, name, email?, decision } → records "agree" or "decline"
import { adminClient, corsHeaders, HttpError, json } from '../_shared/services.ts';

const MAX_RESPONSES = 300;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const db = adminClient();
    const token = req.method === 'GET' ? new URL(req.url).searchParams.get('token') ?? '' : '';
    if (req.method === 'GET') {
      const { id: _id, ...publicInfo } = await info(db, token);
      return json(publicInfo);
    }
    if (req.method !== 'POST') throw new HttpError(405, 'Method not allowed');

    const body = await req.json().catch(() => ({}));
    if (body.website) return json({ ok: true }); // honeypot field, filled only by bots
    const r = await info(db, String(body.token ?? ''));
    const name = String(body.name ?? '').replace(/\s+/g, ' ').trim().slice(0, 120);
    const email = String(body.email ?? '').trim().toLowerCase().slice(0, 200) || null;
    const decision = body.decision === 'agree' ? 'agree' : body.decision === 'decline' ? 'decline' : null;
    if (!name) throw new HttpError(400, 'Please enter your name.');
    if (!decision) throw new HttpError(400, 'Choose agree or decline.');
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'That email address doesn’t look right.');

    const { count } = await db.from('consent_responses').select('id', { count: 'exact', head: true }).eq('request_id', r.id);
    if ((count ?? 0) >= MAX_RESPONSES) throw new HttpError(429, 'This link has reached its limit.');
    const { error } = await db.from('consent_responses').insert({ request_id: r.id, name, email, decision });
    if (error) throw new Error(error.message);
    return json({ ok: true, decision });
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    if (status === 500) console.error('consent error', e);
    return json({ error: (e as Error).message }, status);
  }
});

// deno-lint-ignore no-explicit-any
async function info(db: any, token: string) {
  if (!/^[A-Za-z0-9_-]{12,64}$/.test(token)) throw new HttpError(404, 'This consent link doesn’t exist.');
  const { data } = await db.from('consent_requests').select('id, title, organizer, expires_at').eq('token', token).maybeSingle();
  if (!data) throw new HttpError(404, 'This consent link doesn’t exist.');
  if (new Date(data.expires_at).getTime() < Date.now()) throw new HttpError(410, 'This consent link has expired.');
  return { id: data.id, title: data.title, organizer: data.organizer, app: Deno.env.get('APP_NAME') ?? 'Murmur' };
}
