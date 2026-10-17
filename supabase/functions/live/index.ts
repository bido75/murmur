// POST /token → a short-lived Deepgram token for the live transcript shown while recording
// (browser and desktop app). The final transcript still comes from the normal pipeline.
import { corsHeaders, HttpError, json, requireUser } from '../_shared/services.ts';
import { liveParams } from '../_shared/stt.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const { client } = await requireUser(req);
    const key = Deno.env.get('DEEPGRAM_API_KEY');
    if (!key) throw new HttpError(503, 'Transcription is not set up.');
    const res = await fetch('https://api.deepgram.com/v1/auth/grant', {
      method: 'POST',
      headers: { Authorization: `Token ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ttl_seconds: 60 }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.access_token) throw new Error(`Couldn't start the live transcript (${res.status})`);
    const { data: s } = await client.from('user_settings').select('language, redact').maybeSingle();
    const params = liveParams({ language: s?.language ?? null, redact: s?.redact ?? [] });
    return json({ token: body.access_token, url: `wss://api.deepgram.com/v1/listen?${params}` });
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    return json({ error: (e as Error).message }, status);
  }
});
