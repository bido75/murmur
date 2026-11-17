// Pure deck-planning logic: types, themes, the slide tool schema, the visual-planning
// prompt, chart validation and slide sanitization. No pptxgenjs / Deno npm imports here,
// so it is unit-testable under the plain Node test runner (see deck_plan.test.ts).

export type DeckKind = 'client_update' | 'site_report' | 'pitch' | 'proposal';
export type DeckStyle = 'corporate' | 'minimal' | 'tech' | 'research' | 'construction' | 'dark' | 'creative';

export const DECK_KINDS: Record<DeckKind, { label: string; brief: string }> = {
  client_update: {
    label: 'Client update',
    brief: 'A status update for a client: where things stand, what was decided, what happens next and what is needed from them.',
  },
  site_report: {
    label: 'Site report',
    brief: 'A construction/field site report: observations and issues by location, safety items, progress, and required actions.',
  },
  pitch: {
    label: 'Pitch deck',
    brief: 'A short persuasive deck: the problem, the proposed approach, why it works, and the ask, using only what was said.',
  },
  proposal: {
    label: 'Proposal',
    brief: 'A proposal: the need as discussed, the proposed scope, timeline and responsibilities as stated, open questions, next steps.',
  },
};

// ---------- Themes ----------

export type DeckTheme = {
  name: string;
  ink: string;
  muted: string;
  accent: string;
  soft: string;
  line: string;
  bg: string;
  onAccent: string;
  font: string;
};

export const THEMES: Record<DeckStyle, DeckTheme> = {
  corporate: { name: 'Executive Corporate', ink: '1A1C1A', muted: '6B6F6A', accent: '1F6F5C', soft: 'E3EFEB', line: 'E4E1DA', bg: 'FFFFFF', onAccent: 'FFFFFF', font: 'Calibri' },
  minimal: { name: 'Modern Minimal', ink: '1F2937', muted: '6B7280', accent: '2563EB', soft: 'EFF6FF', line: 'E5E7EB', bg: 'FFFFFF', onAccent: 'FFFFFF', font: 'Calibri' },
  tech: { name: 'Technology & Innovation', ink: 'E5E7EB', muted: '9CA3AF', accent: '22D3EE', soft: '0F172A', line: '1E293B', bg: '0B1220', onAccent: '06121F', font: 'Calibri' },
  research: { name: 'Research & Education', ink: '1E293B', muted: '64748B', accent: '7C3AED', soft: 'F1F5F9', line: 'E2E8F0', bg: 'FFFFFF', onAccent: 'FFFFFF', font: 'Calibri' },
  construction: { name: 'Construction & Engineering', ink: '1C1917', muted: '78716C', accent: 'D97706', soft: 'FFF7ED', line: 'E7E5E4', bg: 'FFFFFF', onAccent: 'FFFFFF', font: 'Calibri' },
  dark: { name: 'Premium Dark', ink: 'F5F5F4', muted: 'A8A29E', accent: 'F59E0B', soft: '1C1917', line: '292524', bg: '0F0F0F', onAccent: '1C1102', font: 'Calibri' },
  creative: { name: 'Creative Presentation', ink: '1E1B4B', muted: '6D6A9C', accent: 'EC4899', soft: 'FDF2F8', line: 'E9E7F5', bg: 'FFFFFF', onAccent: 'FFFFFF', font: 'Calibri' },
};

export function resolveTheme(style: DeckStyle | undefined): DeckTheme {
  return THEMES[style ?? 'corporate'] ?? THEMES.corporate;
}

// ---------- Slide shapes ----------

/** A resolved image (generated or uploaded) that can accompany any slide layout. */
export type SlideImage = { dataUri: string; illustrative: boolean };
/** The model's request for an image on a slide: a short description of what to depict. */
export type ImageCaption = string;

export type BulletSlide = { kind: 'bullets'; title: string; bullets: string[]; speakerNotes?: string; caption?: string; image?: SlideImage };
export type TwoColumnSlide = { kind: 'two_column'; title: string; left: { heading: string; bullets: string[] }; right: { heading: string; bullets: string[] }; speakerNotes?: string; caption?: string; image?: SlideImage };
export type ProcessSlide = { kind: 'process'; title: string; steps: { heading: string; detail: string }[]; speakerNotes?: string; caption?: string; image?: SlideImage };
export type TimelineSlide = { kind: 'timeline'; title: string; milestones: { label: string; note: string }[]; speakerNotes?: string; caption?: string; image?: SlideImage };
export type PillarsSlide = { kind: 'pillars'; title: string; pillars: { heading: string; detail: string }[]; speakerNotes?: string; caption?: string; image?: SlideImage };
export type ChartSlide = { kind: 'chart'; title: string; chartType: 'bar' | 'line' | 'doughnut'; categories: string[]; series: { name: string; values: number[] }[]; speakerNotes?: string; caption?: string; image?: SlideImage };
export type KpiSlide = { kind: 'kpi'; title: string; metrics: { label: string; value: string }[]; speakerNotes?: string; caption?: string; image?: SlideImage };
export type EditorialSlide = { kind: 'editorial'; title: string; statement: string; speakerNotes?: string; caption?: string; image?: SlideImage };
export type VisualSlide = { kind: 'visual'; title: string; caption: string; image?: SlideImage; speakerNotes?: string };
export type NarrativeSlide = BulletSlide | TwoColumnSlide | ProcessSlide | TimelineSlide | PillarsSlide | ChartSlide | KpiSlide | EditorialSlide | VisualSlide;

export type DeckData = {
  title: string;
  subtitle: string;
  footer: string;
  slides: NarrativeSlide[];
  decisions: { text: string; quote: string | null }[];
  tasks: { text: string; owner: string | null; due: string | null; status: 'open' | 'done' }[];
  questions: string[];
  safety?: { text: string; location: string | null }[];
  photos?: DeckPhoto[];
};

export type DeckPhoto = { dataUri: string; width: number | null; height: number | null; caption: string; detail: string | null; quote: string | null };

/** Fit an image of w×h inside a box, keeping its shape, centered. */
export function fitImage(w: number | null, h: number | null, box: { x: number; y: number; w: number; h: number }) {
  const ratio = w && h && w > 0 && h > 0 ? w / h : 4 / 3;
  let iw = box.w;
  let ih = iw / ratio;
  if (ih > box.h) {
    ih = box.h;
    iw = ih * ratio;
  }
  return { x: box.x + (box.w - iw) / 2, y: box.y + (box.h - ih) / 2, w: iw, h: ih };
}

export const DECK_TOOL = {
  name: 'write_deck',
  description: 'Write the narrative slides of the deck, choosing the right visual layout per slide.',
  input_schema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Deck title, max 8 words.' },
      subtitle: { type: 'string', description: 'One line, e.g. who it is for and the date range.' },
      slides: {
        type: 'array',
        description: '3 to 9 slides. Do NOT include a title slide, a decisions slide or an action-items slide; those are added automatically. Choose the layout that matches each slide\'s meaning.',
        items: {
          type: 'object',
          properties: {
            kind: { type: 'string', enum: ['bullets', 'two_column', 'process', 'timeline', 'pillars', 'chart', 'kpi', 'editorial', 'visual'], description: 'The visual layout. bullets/two_column are plain text; process/timeline/pillars draw native diagrams; chart draws a data chart; kpi draws metric cards; editorial is a single statement; visual is a hero/concept slide with an image.' },
            title: { type: 'string', description: 'Slide headline stating the point, max 10 words.' },
            bullets: { type: 'array', items: { type: 'string' }, description: 'For bullets: 2–6 bullets, each under 18 words.' },
            left: { type: 'object', properties: { heading: { type: 'string' }, bullets: { type: 'array', items: { type: 'string' } } } },
            right: { type: 'object', properties: { heading: { type: 'string' }, bullets: { type: 'array', items: { type: 'string' } } } },
            steps: { type: 'array', items: { type: 'object', properties: { heading: { type: 'string' }, detail: { type: 'string' } } }, description: 'For process: 3–5 ordered steps, each with a short heading and one line.' },
            milestones: { type: 'array', items: { type: 'object', properties: { label: { type: 'string' }, note: { type: 'string' } } }, description: 'For timeline: 3–6 milestones in order, each with a date/phase label and a short note.' },
            pillars: { type: 'array', items: { type: 'object', properties: { heading: { type: 'string' }, detail: { type: 'string' } } }, description: 'For pillars: 2–4 parallel themes, each a short heading and one line.' },
            chartType: { type: 'string', enum: ['bar', 'line', 'doughnut'] },
            categories: { type: 'array', items: { type: 'string' }, description: 'For chart: the category labels (2–8).' },
            series: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, values: { type: 'array', items: { type: 'number' } } } }, description: 'For chart: 1–3 series; every value must be a number stated in the material.' },
            metrics: { type: 'array', items: { type: 'object', properties: { label: { type: 'string' }, value: { type: 'string' } } }, description: 'For kpi: 2–4 metrics, value as a short string (number or phrase) from the material.' },
            statement: { type: 'string', description: 'For editorial: one strong sentence, max 24 words.' },
            caption: { type: 'string', description: 'Optional: describe an illustration to accompany this slide (no text in the image). Omit when an image does not help.' },
            notes: { type: 'string', description: 'Optional speaker notes for this slide, 1–2 sentences to say aloud (factual, from the material).' },
          },
          required: ['kind', 'title'],
        },
      },
    },
    required: ['title', 'subtitle', 'slides'],
  },
} as const;

export type DeckEnhancements = { images: boolean; diagrams: boolean; charts: boolean; notes: boolean };

export function deckSystemPrompt(kind: DeckKind, audience: string | null, e?: DeckEnhancements): string {
  const enh = e ?? { images: true, diagrams: true, charts: true, notes: true };
  const visualRules = [
    'Visual planning — choose the layout that matches the slide\'s meaning, not a random image:',
    '- Use process for a sequence of steps or phases that were actually described.',
    '- Use timeline for dated milestones or a roadmap actually stated.',
    '- Use pillars for parallel themes, priorities or components that were named (exactly those, no invented ones).',
    '- Use two_column for a comparison, trade-off or before/after.',
    enh.charts
      ? '- Use chart ONLY when the material states real numbers for the same categories; otherwise do not make a chart.'
      : '- Do not make charts.',
    enh.diagrams
      ? '- Prefer native, editable diagrams over describing an image in words.'
      : '- Use plain bullets, not diagrams.',
    '- Use kpi for a few concrete figures (a count, a date, a budget) actually given.',
    '- Use editorial for a single strong takeaway.',
    enh.images ? '- Use visual for a hero or concept slide that benefits from an illustration (at most 1–2 total).' : '- Do not use the visual layout.',
    '- Use bullets otherwise. Do not force a diagram onto content that is just a list.',
  ];
  const notesRule = enh.notes
    ? 'For every slide, write a one-to-two sentence speaker note (the notes field) a presenter can say aloud; keep it factual.'
    : 'Do not write speaker notes.';
  const imagesRule = enh.images
    ? 'For any slide where an illustration genuinely helps (a concept, hero idea or abstract idea), write a short caption (caption field) describing it; it must not contain words or depict a real place/product as if photographed. Use sparingly, not on every slide.'
    : '';
  return [
    'You turn verified meeting notes into a clear, professional slide deck.',
    `Deck type: ${DECK_KINDS[kind].brief}`,
    audience ? `Audience: ${audience}` : '',
    'Rules:',
    '- Use only facts in the material. Never invent numbers, dates, prices, names, statistics, budgets, progress levels or commitments. If something a deck like this would normally include is missing, leave it out.',
    '- Each slide title states the point ("Foundation pour moved to Oct 22"), not a topic ("Schedule").',
    '- Short, concrete wording. No filler, no marketing language.',
    notesRule,
    imagesRule,
    '',
    ...visualRules,
  ]
    .filter(Boolean)
    .join('\n');
}

/** Structural check on model chart output: well-formed, finite, matching series. */
export function validateChartData(c: ChartSlide): string | null {
  if (!Array.isArray(c.categories) || c.categories.length < 2) return 'chart has fewer than 2 categories';
  if (c.categories.length > 8) return 'chart has too many categories (max 8)';
  if (!Array.isArray(c.series) || c.series.length === 0) return 'chart has no series';
  if (c.series.length > 3) return 'chart has too many series (max 3)';
  for (const s of c.series) {
    if (!Array.isArray(s.values) || s.values.length !== c.categories.length) return `series "${s.name}" length does not match categories`;
    for (const v of s.values) if (typeof v !== 'number' || !Number.isFinite(v)) return `series "${s.name}" has a non-numeric value`;
  }
  return null;
}

/** Clean model output: drop empty slides, trim overly long lists, drop malformed charts. */
export function sanitizeSlides(raw: unknown): NarrativeSlide[] {
  const out: NarrativeSlide[] = [];
  for (const s of Array.isArray(raw) ? raw : []) {
    const title = String(s?.title ?? '').trim();
    if (!title) continue;
    const clean = (b: unknown) => (Array.isArray(b) ? b.map((x) => String(x).trim()).filter(Boolean) : []);
    const kind = String(s.kind ?? 'bullets');
    const speakerNotes = String(s?.notes ?? '').trim() || undefined;
    const imageCaption = String(s?.caption ?? '').trim() || undefined;
    if (kind === 'two_column' && s.left && s.right) {
      const left = { heading: String(s.left.heading ?? '').trim(), bullets: clean(s.left.bullets).slice(0, 6) };
      const right = { heading: String(s.right.heading ?? '').trim(), bullets: clean(s.right.bullets).slice(0, 6) };
      if (left.bullets.length || right.bullets.length) out.push({ kind: 'two_column', title, left, right, speakerNotes, caption: imageCaption });
    } else if (kind === 'process') {
      const steps = (Array.isArray(s.steps) ? s.steps : []).map((x: any) => ({ heading: String(x?.heading ?? '').trim(), detail: String(x?.detail ?? '').trim() })).filter((x: any) => x.heading).slice(0, 5);
      if (steps.length >= 2) out.push({ kind: 'process', title, steps, speakerNotes, caption: imageCaption });
    } else if (kind === 'timeline') {
      const milestones = (Array.isArray(s.milestones) ? s.milestones : []).map((x: any) => ({ label: String(x?.label ?? '').trim(), note: String(x?.note ?? '').trim() })).filter((x: any) => x.label).slice(0, 6);
      if (milestones.length >= 2) out.push({ kind: 'timeline', title, milestones, speakerNotes, caption: imageCaption });
    } else if (kind === 'pillars') {
      const pillars = (Array.isArray(s.pillars) ? s.pillars : []).map((x: any) => ({ heading: String(x?.heading ?? '').trim(), detail: String(x?.detail ?? '').trim() })).filter((x: any) => x.heading).slice(0, 4);
      if (pillars.length >= 2) out.push({ kind: 'pillars', title, pillars, speakerNotes, caption: imageCaption });
    } else if (kind === 'chart') {
      const c: ChartSlide = {
        kind: 'chart',
        title,
        chartType: s.chartType === 'line' || s.chartType === 'doughnut' ? s.chartType : 'bar',
        categories: clean(s.categories).slice(0, 8),
        series: (Array.isArray(s.series) ? s.series : []).map((x: any) => ({ name: String(x?.name ?? '').trim(), values: (Array.isArray(x?.values) ? x.values : []).map((v: any) => Number(v)) })).slice(0, 3),
        speakerNotes,
        caption: imageCaption,
      };
      if (!validateChartData(c)) out.push(c);
    } else if (kind === 'kpi') {
      const metrics = (Array.isArray(s.metrics) ? s.metrics : []).map((x: any) => ({ label: String(x?.label ?? '').trim(), value: String(x?.value ?? '').trim() })).filter((x: any) => x.value).slice(0, 4);
      if (metrics.length) out.push({ kind: 'kpi', title, metrics, speakerNotes, caption: imageCaption });
    } else if (kind === 'editorial') {
      const statement = String(s.statement ?? '').trim();
      if (statement) out.push({ kind: 'editorial', title, statement: statement.slice(0, 180), speakerNotes, caption: imageCaption });
    } else if (kind === 'visual') {
      const caption = String(s.caption ?? '').trim();
      if (caption) out.push({ kind: 'visual', title, caption: caption.slice(0, 300), speakerNotes });
    } else {
      const bullets = clean(s.bullets);
      if (bullets.length) out.push({ kind: 'bullets', title, bullets: bullets.slice(0, 7), speakerNotes, caption: imageCaption });
    }
  }
  return out.slice(0, 12);
}