// Deno-side helpers: Supabase clients, Deepgram and Claude calls.
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import type { Utterance } from './verify.ts';

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function env(name: string, fallback?: string): string {
  const v = Deno.env.get(name) ?? fallback;
  if (!v) throw new Error(`Missing secret ${name}`);
  return v;
}

/** Client acting as the caller (RLS applies). */
export function userClient(req: Request): SupabaseClient {
  return createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
    auth: { persistSession: false },
  });
}

/** Service client for background writes, used only after ownership is checked. */
export function adminClient(): SupabaseClient {
  return createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false },
  });
}

export async function requireUser(req: Request): Promise<{ id: string; client: SupabaseClient }> {
  const client = userClient(req);
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) throw new HttpError(401, 'Not signed in');
  return { id: data.user.id, client };
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

type DeepgramUtterance = { start: number; end: number; speaker?: number; transcript: string };

/** Transcribe one audio URL with speaker labels. Times come back in ms, relative to the file. */
export async function transcribe(audioUrl: string): Promise<{ utterances: Utterance[]; durationMs: number; language: string | null }> {
  const params = new URLSearchParams({
    model: env('DEEPGRAM_MODEL', 'nova-3'),
    smart_format: 'true',
    punctuate: 'true',
    diarize: 'true',
    utterances: 'true',
    detect_language: 'true',
  });
  const res = await fetch(`https://api.deepgram.com/v1/listen?${params}`, {
    method: 'POST',
    headers: { Authorization: `Token ${env('DEEPGRAM_API_KEY')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: audioUrl }),
  });
  if (!res.ok) throw new Error(`Transcription failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
  const body = await res.json();
  const raw: DeepgramUtterance[] = body?.results?.utterances ?? [];
  const utterances = raw
    .filter((u) => u.transcript?.trim())
    .map((u) => ({
      start_ms: Math.round(u.start * 1000),
      end_ms: Math.round(u.end * 1000),
      speaker: u.speaker ?? 0,
      text: u.transcript.trim(),
    }));
  const durationMs = Math.round((body?.metadata?.duration ?? 0) * 1000);
  const language = body?.results?.channels?.[0]?.detected_language ?? null;
  return { utterances, durationMs, language };
}

type ClaudeMessage = { role: 'user' | 'assistant'; content: string };

async function callClaude(payload: Record<string, unknown>) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': env('ANTHROPIC_API_KEY'),
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ model: env('CLAUDE_MODEL', 'claude-sonnet-5-5'), ...payload }),
  });
  if (!res.ok) throw new Error(`Claude request failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
  return await res.json();
}

/** Force a single tool call and return its input. */
export async function claudeStructured<T>(system: string, messages: ClaudeMessage[], tool: { name: string }): Promise<T> {
  const body = await callClaude({
    max_tokens: 8000,
    system,
    messages,
    tools: [tool],
    tool_choice: { type: 'tool', name: tool.name },
  });
  const block = (body.content ?? []).find((b: { type: string }) => b.type === 'tool_use');
  if (!block) throw new Error('Claude returned no structured notes');
  return block.input as T;
}

export async function claudeText(system: string, messages: ClaudeMessage[]): Promise<string> {
  const body = await callClaude({ max_tokens: 1500, system, messages });
  return (body.content ?? [])
    .filter((b: { type: string }) => b.type === 'text')
    .map((b: { text: string }) => b.text)
    .join('\n')
    .trim();
}
