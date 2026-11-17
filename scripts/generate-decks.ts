// Generates one fresh deck per template from a real recording in the local DB, running
// the ACTUAL make-deck pipeline: material -> LLM planning -> sanitize -> image gen ->
// buildPptx -> inspectPptx. Writes each .pptx plus a JSON diagnostics report.
// Run: deno run --allow-net --allow-read --allow-write --allow-run scripts/generate-decks.ts
import { deckSystemPrompt, sanitizeSlides, DECK_TOOL, resolveTheme, type DeckData, type DeckEnhancements, type DeckKind } from 'file:///C:/Users/vinny/Documents/murmur-ready/murmur/supabase/functions/_shared/deck_plan.ts';
import { buildPptx } from 'file:///C:/Users/vinny/Documents/murmur-ready/murmur/supabase/functions/_shared/deck.ts';
import { imageProviderConfig, imageRequest, imageBudget, DEFAULT_IMAGE_BUDGET, type ImageProviderConfig } from 'file:///C:/Users/vinny/Documents/murmur-ready/murmur/supabase/functions/_shared/deck_images.ts';
import { inspectPptx } from 'file:///C:/Users/vinny/Documents/murmur-ready/murmur/supabase/functions/_shared/pptx_verify.ts';

const ROOT = 'C:/Users/vinny/Documents/murmur-ready/murmur';
const OUT = 'C:/Users/vinny/AppData/Local/Temp/opencode/decks';

const env: Record<string, string> = {};
for (const line of Deno.readTextFileSync(`${ROOT}/supabase/functions/.env`).split('\n')) {
  const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
  if (m && !line.trim().startsWith('#')) env[m[1]] = m[2];
}
const OPENROUTER_KEY = env.OPENROUTER_API_KEY;
const LLM_MODEL = env.OPENROUTER_MODEL || 'anthropic/claude-sonnet-4.5';

// One template -> one real recording (richest notes available).
const JOBS: { kind: DeckKind; recording: string }[] = [
  { kind: 'client_update', recording: '9ac39c7b-3e42-4c0a-951e-f77abb961c1c' }, // Yemen Conflict
  { kind: 'site_report', recording: '7c0f55f2-5c20-4882-84ac-d934612291bb' },   // Baba Vanga
  { kind: 'pitch', recording: 'fa344350-3fb2-4414-8df0-52bb15efdaa4' },         // Philosophical
  { kind: 'proposal', recording: '08c80d89-2a55-4583-a2e8-e5ebb128aeeb' },      // Testing Deck Gen
];

const ENH: DeckEnhancements = { images: true, diagrams: true, charts: true, notes: true };

function q(sql: string): string {
  const p = new Deno.Command('docker', { args: ['exec', 'supabase_db_murmur', 'psql', '-U', 'postgres', '-d', 'postgres', '-t', '-A', '-c', sql] }).outputSync();
  return new TextDecoder().decode(p.stdout).trim();
}
function jq(sql: string): unknown {
  const s = q(sql);
  if (!s) return null;
  try { return JSON.parse(s); } catch { return null; }
}

function material(recordingId: string): { title: string; material: string } {
  const title = q(`SELECT title FROM recordings WHERE id='${recordingId}'`).replace(/\|/g, ' ');
  const overview = q(`SELECT COALESCE(overview,'') FROM summaries WHERE recording_id='${recordingId}'`) || '';
  const kp = (jq(`SELECT COALESCE(key_points::text,'[]') FROM summaries WHERE recording_id='${recordingId}'`) as string[]) ?? [];
  const decisions = (jq(`SELECT COALESCE(decisions::text,'[]') FROM summaries WHERE recording_id='${recordingId}'`) as { text: string; verified: boolean }[]) ?? [];
  const questions = (jq(`SELECT COALESCE(open_questions::text,'[]') FROM summaries WHERE recording_id='${recordingId}'`) as string[]) ?? [];
  const conclusions = (jq(`SELECT COALESCE(conclusions::text,'[]') FROM summaries WHERE recording_id='${recordingId}'`) as string[]) ?? [];
  const sections = (jq(`SELECT COALESCE(detailed_sections::text,'[]') FROM summaries WHERE recording_id='${recordingId}'`) as { heading: string; paragraphs: string[] }[]) ?? [];
  const parts = [
    `## ${title}`,
    overview,
    ...kp.map((k) => `- ${k}`),
    ...decisions.filter((d) => d.verified).map((d) => `Decision: ${d.text}`),
    ...questions.map((x) => `Open question: ${x}`),
    ...(conclusions.length ? [`Conclusions: ${conclusions.join('; ')}`] : []),
    ...sections.map((s) => `### ${s.heading}\n${(s.paragraphs ?? []).join('\n')}`),
  ];
  return { title, material: parts.filter(Boolean).join('\n') };
}

function parseJson(text: string): unknown {
  const t = text.trim();
  const f = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const c = (f ? f[1] : t).trim();
  try { return JSON.parse(c); } catch {
    const s = c.indexOf('{'); const e = c.lastIndexOf('}');
    if (s >= 0 && e > s) return JSON.parse(c.slice(s, e + 1));
    throw new Error('LLM returned non-JSON: ' + c.slice(0, 200));
  }
}

async function plan(kind: DeckKind, mat: string): Promise<{ title: string; subtitle: string; slides: unknown }> {
  const schema = DECK_TOOL.input_schema;
  const system = `${deckSystemPrompt(kind, null, ENH)}\n\nAnswer with JSON only, in exactly this shape:\n${JSON.stringify(schema)}`;
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${OPENROUTER_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: LLM_MODEL, messages: [{ role: 'system', content: system }, { role: 'user', content: `Material:\n\n${mat}\n\nTasks: none` }], max_tokens: 12000, response_format: { type: 'json_object' } }),
  });
  if (!res.ok) throw new Error(`LLM ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const j = await res.json();
  return parseJson(j?.choices?.[0]?.message?.content ?? '') as { title: string; subtitle: string; slides: unknown };
}

async function generateImage(cfg: ImageProviderConfig, description: string, style: string): Promise<{ dataUri: string }> {
  const { url, body } = imageRequest(cfg, { description, style, illustrative: true });
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(90_000),
  });
  if (!res.ok) throw new Error(`image ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = await res.json();
  const b64 = j?.data?.[0]?.b64_json;
  if (!b64) throw new Error('image provider returned no image');
  return { dataUri: `data:${j?.data?.[0]?.media_type ?? 'image/png'};base64,${b64}` };
}

Deno.mkdirSync(OUT, { recursive: true });
const report: Record<string, unknown>[] = [];

for (const job of JOBS) {
  const { title, material: mat } = material(job.recording);
  console.log(`\n=== ${job.kind} (${title}) ===`);
  const written = await plan(job.kind, mat);
  const slides = sanitizeSlides(written.slides);
  const deck: DeckData = {
    title: (written.title || title).slice(0, 90),
    subtitle: written.subtitle || job.kind,
    footer: `${title} · ${job.kind}`,
    slides,
    decisions: [],
    tasks: [],
    questions: [],
  };

  const cfg = imageProviderConfig(env);
  const status = { kind: job.kind, title: deck.title, provider: cfg?.name ?? null, requestedCount: 0, generated: 0, failed: 0, reason: null as string | null, embeddedMedia: 0, slides: 0, plannedKinds: slides.map((s) => s.kind) };
  if (cfg) {
    const wanted = deck.slides.filter((s) => (s.caption ?? '').trim());
    status.requestedCount = wanted.length;
    const budget = imageBudget(wanted.length, DEFAULT_IMAGE_BUDGET);
    for (const sl of wanted.slice(0, budget)) {
      try {
        sl.image = { ...(await generateImage(cfg, sl.caption!, resolveTheme(undefined).name)), illustrative: true };
        status.generated += 1;
      } catch (e) {
        status.failed += 1;
        status.reason = status.reason ?? (e as Error).message.slice(0, 200);
      }
    }
  }

  const bytes = await buildPptx(deck, { theme: resolveTheme(undefined) });
  const ins = inspectPptx(bytes);
  status.embeddedMedia = ins.media.length;
  status.slides = ins.slides;
  const file = `${OUT}/${job.kind}.pptx`;
  Deno.writeFileSync(file, bytes);
  report.push(status);
  console.log('  planned kinds:', status.plannedKinds.join(', '));
  console.log('  images: requested', status.requestedCount, '| generated', status.generated, '| failed', status.failed, status.reason ? `| reason: ${status.reason}` : '');
  console.log('  embedded media:', status.embeddedMedia, '| slides:', status.slides, '| wrote', file);
}

Deno.writeFileSync(`${OUT}/report.json`, new TextEncoder().encode(JSON.stringify(report, null, 2)));
console.log('\n=== SUMMARY ===');
for (const r of report) console.log(`${r.kind}: images ${r.generated}/${r.requestedCount} requested, ${r.embeddedMedia} embedded, ${r.slides} slides, ${r.reason ? 'reason: ' + r.reason : 'ok'}`);
