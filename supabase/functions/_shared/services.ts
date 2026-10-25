// Deno-side helpers: Supabase clients, Deepgram and Claude calls.
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import type { Utterance } from './verify.ts';
import { deepgramParams } from './stt.ts';
import { audioContentType } from './ingest.ts';
import { mistralUtterances, sttFallbackOrder, type SttProvider } from './mistral.ts';

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-share-password',
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

/**
 * Rewrite a storage-signed URL so the app can actually fetch it.
 *
 * On a local stack the server sees itself as `http://kong:8000` — the Docker service
 * name — and the signed URLs for stored files come back with that host, which no phone
 * or browser can resolve. EXTERNAL_SUPABASE_URL is the address the app really uses, so
 * the host is swapped for it. The path and the token are untouched, so the URL still
 * opens. In a hosted setup SUPABASE_URL is already the public address and no rewrite
 * happens.
 */
export function clientUrl(url: string | null | undefined): string | null | undefined {
  if (!url) return url;
  const external = (Deno.env.get('EXTERNAL_SUPABASE_URL') ?? '').replace(/\/+$/, '');
  if (!external) return url;
  try {
    const u = new URL(url);
    const e = new URL(external);
    u.protocol = e.protocol;
    u.host = e.host;
    return u.toString();
  } catch {
    return url;
  }
}

function env(name: string, fallback?: string): string {
  const v = Deno.env.get(name) ?? fallback;
  if (!v) throw new Error(`Missing secret ${name}`);
  return v;
}

/**
 * The keys this project publishes. New projects publish an sb_publishable_ key and an
 * sb_secret_ key; older ones publish the anon and service_role keys. Both work with
 * supabase-js, so the new ones are used when they are there.
 */
function publishableKey(): string {
  const key = Deno.env.get('SUPABASE_PUBLISHABLE_KEY') || Deno.env.get('SUPABASE_ANON_KEY');
  if (!key) throw new Error('Missing secret SUPABASE_PUBLISHABLE_KEY');
  return key;
}

function secretKey(): string {
  const key = Deno.env.get('SUPABASE_SECRET_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!key) throw new Error('Missing secret SUPABASE_SECRET_KEY');
  return key;
}

/** Client acting as the caller (RLS applies). */
export function userClient(req: Request): SupabaseClient {
  return createClient(env('SUPABASE_URL'), publishableKey(), {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
    auth: { persistSession: false },
  });
}

/** Service client for background writes, used only after ownership is checked. */
export function adminClient(): SupabaseClient {
  return createClient(env('SUPABASE_URL'), secretKey(), {
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

type DeepgramUtterance = { start: number; end: number; speaker?: number; channel?: number; transcript: string };

/** Does the speech service saying it cannot reach the audio mean it is not routable? */
function cannotReachAudio(status: number, body: string): boolean {
  if (status !== 400) return false;
  return (
    body.includes('REMOTE_CONTENT_ERROR') ||
    body.includes('publicly routable') ||
    body.includes('Unable to fetch')
  );
}

/** The audio itself, from the storage bucket when we know its path, otherwise from its link. */
async function readAudio(audioUrl: string, storagePath?: string): Promise<ArrayBuffer> {
  if (storagePath) {
    const { data, error } = await adminClient().storage.from('audio').download(storagePath);
    if (error) throw new Error(`Could not read the audio: ${error.message}`);
    return await data.arrayBuffer();
  }
  const res = await fetch(audioUrl);
  if (!res.ok) throw new Error(`Could not download the audio (${res.status})`);
  return await res.arrayBuffer();
}

/**
 * Transcribe with Mistral's Voxtral.
 *
 * Mistral is given the audio itself: it has no way to fetch a link, unlike Deepgram,
 * so the file is uploaded on every request. Speaker labels are asked for, because a
 * meeting has more than one person in it.
 */
type SttResult = { utterances: (Utterance & { channel?: number })[]; durationMs: number; language: string | null };
type SttOptions = { language?: string | null; redact?: string[]; multichannel?: boolean };

async function transcribeWithMistral(
  audioUrl: string,
  keyterms: string[],
  opts: SttOptions,
  storagePath?: string,
): Promise<SttResult> {
  const bytes = await readAudio(audioUrl, storagePath);
  const name = storagePath ?? audioUrl;
  const extension = name.split('.').pop()?.toLowerCase() ?? 'wav';
  const form = new FormData();
  form.append('model', env('MISTRAL_STT_MODEL', 'voxtral-mini-transcribe-3'));
  form.append('file', new Blob([bytes], { type: audioContentType(name) }), `audio.${extension}`);
  // Without this the answer comes back as one block of text with no times.
  form.append('timestamp_granularities', 'segment');
  form.append('diarize', 'true');
  if (opts.language) form.append('language', opts.language);
  // The project's own words, spelled the way the project spells them.
  for (const term of keyterms) form.append('context_bias', term);

  const res = await fetch('https://api.mistral.ai/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env('MISTRAL_API_KEY')}` },
    body: form,
    signal: AbortSignal.timeout(sttTimeoutMs()),
  });
  if (!res.ok) throw new Error(`Transcription failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
  return mistralUtterances(await res.json());
}

/** How long to wait for the audio to be read. */
function sttTimeoutMs(): number {
  const raw = Number(Deno.env.get('STT_TIMEOUT_MS') ?? '');
  return Number.isFinite(raw) && raw > 0 ? raw : 300_000;
}

/** Transcribe with Deepgram, given the audio as a link and falling back to its bytes. */
async function transcribeWithDeepgram(
  audioUrl: string,
  keyterms: string[],
  opts: SttOptions,
  storagePath?: string,
): Promise<SttResult> {
  const o = {
    model: env('DEEPGRAM_MODEL', 'nova-3'),
    keyterms,
    language: opts.language ?? null,
    redact: opts.redact ?? [],
    multichannel: Boolean(opts.multichannel),
    // Keep customer audio out of Deepgram's model-improvement program (the app promises
    // recordings aren't used to train AI). Set DEEPGRAM_MIP_OPT_OUT=false to change.
    mipOptOut: (Deno.env.get('DEEPGRAM_MIP_OPT_OUT') ?? 'true') !== 'false',
  };
  const params = deepgramParams(o, true);
  const send = (p: URLSearchParams, body: BodyInit, contentType: string) =>
    fetch(`https://api.deepgram.com/v1/listen?${p}`, {
      method: 'POST',
      headers: { Authorization: `Token ${env('DEEPGRAM_API_KEY')}`, 'Content-Type': contentType },
      body,
    });
  const byLink = (p: URLSearchParams) =>
    send(p, JSON.stringify({ url: audioUrl }), 'application/json');

  let res = await byLink(params);
  // Hints are a bonus: if Deepgram rejects them, transcribe without rather than fail.
  if (res.status === 400 && params.has('keyterm')) {
    console.warn('Deepgram rejected keyterms, retrying without', (await res.text()).slice(0, 200));
    res = await byLink(deepgramParams(o, false));
  }

  // The service could not reach the audio: it is on a machine only this computer can
  // see. Send the audio itself instead of a link to it.
  if (!res.ok && storagePath) {
    const failed = await res.text();
    if (cannotReachAudio(res.status, failed)) {
      const { data, error } = await adminClient().storage.from('audio').download(storagePath);
      if (error) throw new Error(`Could not read the audio: ${error.message}`);
      console.warn('The audio is not reachable from outside, sending it directly');
      const bytes = new Uint8Array(await data.arrayBuffer());
      res = await send(deepgramParams(o, false), bytes, audioContentType(storagePath));
    } else {
      throw new Error(`Transcription failed (${res.status}): ${failed.slice(0, 300)}`);
    }
  }
  if (!res.ok) throw new Error(`Transcription failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
  const body = await res.json();
  const raw: DeepgramUtterance[] = body?.results?.utterances ?? [];
  const utterances = raw
    .filter((u) => u.transcript?.trim())
    .map((u) => ({
      start_ms: Math.round(u.start * 1000),
      end_ms: Math.round(u.end * 1000),
      speaker: u.speaker ?? 0,
      channel: u.channel ?? 0,
      text: u.transcript.trim(),
    }));
  const durationMs = Math.round((body?.metadata?.duration ?? 0) * 1000);
  const language = body?.results?.channels?.[0]?.detected_language ?? null;
  return { utterances, durationMs, language };
}

/** A network blip worth a retry, rather than a fault the other engine would hit too. */
function isTransientNetworkError(e: Error): boolean {
  return /name resolution|dns error|temporary failure|econnreset|etimedout|fetch failed|networkerror/i.test(e.message);
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Transcribe one audio file, with speaker labels. Times come back in ms, relative to
 * the file.
 *
 * Both engines are tried: the configured one first, then the other, so one being
 * down, rate-limited or unreachable does not fail the recording. A transient network
 * blip is retried once before moving on. A redaction still goes only to Deepgram,
 * which is the engine that can keep it.
 */
export async function transcribe(
  audioUrl: string,
  keyterms: string[] = [],
  opts: SttOptions = {},
  fallback?: { storagePath: string },
): Promise<SttResult> {
  const wantsRedaction = (opts.redact ?? []).length > 0;
  const order = sttFallbackOrder(Deno.env.get('STT_PROVIDER'), wantsRedaction);

  let lastError: Error | null = null;
  const backoff = [500, 1500]; // waits before the second and third tries
  for (const engine of order) {
    const key = engine === 'mistral' ? 'MISTRAL_API_KEY' : 'DEEPGRAM_API_KEY';
    if (!Deno.env.get(key)) continue; // not configured, so not something to fall back to

    for (let attempt = 0; attempt <= backoff.length; attempt++) {
      try {
        return engine === 'mistral'
          ? await transcribeWithMistral(audioUrl, keyterms, opts, fallback?.storagePath)
          : await transcribeWithDeepgram(audioUrl, keyterms, opts, fallback?.storagePath);
      } catch (e) {
        lastError = e as Error;
        if (attempt < backoff.length && isTransientNetworkError(lastError)) {
          console.warn(`${engine} hit a network blip, retrying`, lastError.message.slice(0, 200));
          await sleep(backoff[attempt]);
          continue;
        }
        console.warn(`${engine} transcription failed`, lastError.message.slice(0, 200));
        break;
      }
    }
  }
  throw lastError ?? new Error('No speech engine is configured (set DEEPGRAM_API_KEY or MISTRAL_API_KEY)');
}

type ClaudeMessage = { role: 'user' | 'assistant'; content: string };

async function callClaude(payload: Record<string, unknown>) {
  const headers: Record<string, string> = {
    'x-api-key': env('ANTHROPIC_API_KEY'),
    'anthropic-version': '2023-06-01',
    'content-type': 'application/json',
  };
  // Some keys belong to a workspace rather than to the whole account. Those need to
  // say which workspace, and the API says so plainly if the header is missing.
  const workspace = Deno.env.get('ANTHROPIC_WORKSPACE_ID');
  if (workspace) headers['anthropic-workspace-id'] = workspace;
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers,
    body: JSON.stringify({ model: env('CLAUDE_MODEL', 'claude-sonnet-5-5'), ...payload }),
  });
  if (!res.ok) {
    const text = (await res.text()).slice(0, 300);
    // The API's own words are better than ours: a key that belongs to a workspace
    // needs to say which one.
    throw new Error(`Claude request failed (${res.status}): ${text}`);
  }
  return await res.json();
}

/**
 * A tool the model has to fill in. The schema is what the local providers are given
 * instead of a real tool call.
 */
type StructuredTool = {
  name: string;
  description?: string;
  input_schema?: Record<string, unknown>;
};

/**
 * Which service writes the notes.
 *
 * Claude is the best of them, but a key that belongs to a workspace only works when
 * that workspace is named, and a local model keeps everything on this computer. So
 * the provider is chosen by what is actually set up, and can be pinned with
 * LLM_PROVIDER=anthropic|openrouter|ollama.
 */
export type LlmProvider = 'anthropic' | 'openrouter' | 'ollama';

export function llmProvider(): LlmProvider {
  const asked = (Deno.env.get('LLM_PROVIDER') ?? '').trim().toLowerCase();
  if (asked === 'anthropic' || asked === 'openrouter' || asked === 'ollama') return asked;
  if (Deno.env.get('ANTHROPIC_WORKSPACE_ID')) return 'anthropic';
  if (Deno.env.get('OPENROUTER_API_KEY')) return 'openrouter';
  if (Deno.env.get('ANTHROPIC_API_KEY')) return 'anthropic';
  return 'ollama';
}

/** Pull JSON out of a model answer, whatever it wrapped it in. */
function readJson(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced ? fenced[1] : trimmed).trim();
  const from = (s: string) => {
    try {
      return JSON.parse(s);
    } catch {
      return undefined;
    }
  };
  const whole = from(candidate);
  if (whole !== undefined) return whole;
  // Some models add a sentence around the JSON.
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start >= 0 && end > start) {
    const part = from(candidate.slice(start, end + 1));
    if (part !== undefined) return part;
  }
  throw new Error('The model did not return the JSON that was asked for');
}

/** How long to wait for the notes before giving up. A local model on a slow computer
 * can take a couple of minutes. */
function llmTimeoutMs(): number {
  const raw = Number(Deno.env.get('LLM_TIMEOUT_MS') ?? '');
  return Number.isFinite(raw) && raw > 0 ? raw : 300_000;
}

async function callOpenRouter(
  system: string,
  messages: ClaudeMessage[],
  tool?: StructuredTool,
): Promise<{ text: string; toolInput: unknown }> {
  const schema = tool?.input_schema;
  const prompt = schema
    ? `${system}\n\nAnswer with JSON only, in exactly this shape:\n${JSON.stringify(schema)}`
    : system;
  const body: Record<string, unknown> = {
    model: env('OPENROUTER_MODEL', 'anthropic/claude-sonnet-4.5'),
    messages: [{ role: 'system', content: prompt }, ...messages],
    max_tokens: 4000,
  };
  const headers = {
    Authorization: `Bearer ${env('OPENROUTER_API_KEY')}`,
    'Content-Type': 'application/json',
  };
  const ask = (b: Record<string, unknown>) =>
    fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers,
      body: JSON.stringify(b),
      signal: AbortSignal.timeout(llmTimeoutMs()),
    });

  let res = await ask(tool ? { ...body, response_format: { type: 'json_object' } } : body);
  // Not every model on OpenRouter takes a JSON mode. Ask again without it and let
  // the answer be read instead.
  if (!res.ok && tool && res.status === 400) {
    console.warn('OpenRouter refused the JSON mode, retrying without it', (await res.text()).slice(0, 200));
    res = await ask(body);
  }
  if (!res.ok) throw new Error(`OpenRouter request failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
  const json = await res.json();
  const text: string = json?.choices?.[0]?.message?.content ?? '';
  if (!text.trim()) throw new Error('OpenRouter returned an empty answer');
  return { text: text.trim(), toolInput: tool ? readJson(text) : undefined };
}

async function callOllama(
  system: string,
  messages: ClaudeMessage[],
  tool?: StructuredTool,
): Promise<{ text: string; toolInput: unknown }> {
  const base = env('OLLAMA_BASE_URL', 'http://host.docker.internal:11434').replace(/\/+$/, '');
  const schema = tool?.input_schema;
  const prompt = schema
    ? `${system}\n\nAnswer with JSON only, in exactly this shape:\n${JSON.stringify(schema)}`
    : system;
  const body: Record<string, unknown> = {
    model: env('OLLAMA_MODEL', 'llama3.2:3b-instruct-q4_K_M'),
    messages: [{ role: 'system', content: prompt }, ...messages],
    stream: false,
  };
  // Ollama takes the schema itself, so the answer comes back already shaped.
  if (tool) body.format = schema;
  const res = await fetch(`${base}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(llmTimeoutMs()),
  });
  if (!res.ok) throw new Error(`The local model failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
  const json = await res.json();
  const text: string = json?.message?.content ?? '';
  if (!text.trim()) throw new Error('The local model returned an empty answer');
  return { text: text.trim(), toolInput: tool ? readJson(text) : undefined };
}

/** Ask the chosen provider for a filled-in tool, and return what it put in it. */
export async function llmStructured<T>(system: string, messages: ClaudeMessage[], tool: StructuredTool): Promise<T> {
  const provider = llmProvider();
  if (provider === 'openrouter') {
    const out = await callOpenRouter(system, messages, tool);
    return out.toolInput as T;
  }
  if (provider === 'ollama') {
    const out = await callOllama(system, messages, tool);
    return out.toolInput as T;
  }
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

/** Ask the chosen provider for plain text. */
export async function llmText(system: string, messages: ClaudeMessage[]): Promise<string> {
  const provider = llmProvider();
  if (provider === 'openrouter') return (await callOpenRouter(system, messages)).text;
  if (provider === 'ollama') return (await callOllama(system, messages)).text;
  const body = await callClaude({ max_tokens: 1500, system, messages });
  return (body.content ?? [])
    .filter((b: { type: string }) => b.type === 'text')
    .map((b: { text: string }) => b.text)
    .join('\n')
    .trim();
}
