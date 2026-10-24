// Which service writes the notes.
//
// The app says what happens to the words of a recording, and it must not claim
// anything it cannot show. This tells the app what is actually set up, so the
// settings screen can name the right thing.
//
//   GET /  -> { provider, local, label }
//
// The provider is decided by the server's settings. It is reported, never changed
// from here: the keys live on the server and this endpoint has no business taking
// one over the wire.
import { corsHeaders, HttpError, json, llmProvider, requireUser } from '../_shared/services.ts';

const LABELS: Record<string, string> = {
  anthropic: 'Claude (Anthropic)',
  openrouter: 'OpenRouter',
  ollama: 'a model running on this device',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    if (req.method !== 'GET') throw new HttpError(405, 'Method not allowed');
    await requireUser(req);
    const provider = llmProvider();
    return json({
      provider,
      // A local model keeps the words on the device as well as the audio. Anything
      // else sends them off it.
      local: provider === 'ollama',
      label: LABELS[provider] ?? provider,
    });
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    if (status === 500) console.error('notes-provider error', e);
    return json({ error: (e as Error).message }, status);
  }
});
