// Builds a .pptx from a deck spec. Narrative slides come from the model; the
// decisions and action-item slides are filled straight from verified data, so the
// facts that matter most are never paraphrased.
import pptxgenModule from 'npm:pptxgenjs@3';

// pptxgenjs ships CommonJS types that Deno can't see as a constructor; the runtime
// default export is the class. Typed loosely here, exercised by the render check.
// deno-lint-ignore no-explicit-any
type Pptx = any;
// deno-lint-ignore no-explicit-any
type Slide = any;
const PptxGen = pptxgenModule as unknown as new () => Pptx;

export type DeckKind = 'client_update' | 'site_report' | 'pitch' | 'proposal';

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

export type BulletSlide = { kind: 'bullets'; title: string; bullets: string[] };
export type TwoColumnSlide = { kind: 'two_column'; title: string; left: { heading: string; bullets: string[] }; right: { heading: string; bullets: string[] } };
export type NarrativeSlide = BulletSlide | TwoColumnSlide;

export type DeckData = {
  title: string;
  subtitle: string;
  footer: string;
  slides: NarrativeSlide[];
  decisions: { text: string; quote: string | null }[];
  tasks: { text: string; owner: string | null; due: string | null; status: 'open' | 'done' }[];
  questions: string[];
  /** Site reports: safety items from the verified site log, shown on their own slide. */
  safety?: { text: string; location: string | null }[];
  /** Site reports: photos with what was said when they were taken. */
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
  description: 'Write the narrative slides of the deck.',
  input_schema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Deck title, max 8 words.' },
      subtitle: { type: 'string', description: 'One line, e.g. who it is for and the date range.' },
      slides: {
        type: 'array',
        description: '3 to 7 slides. Do NOT include a title slide, a decisions slide or an action-items slide; those are added automatically.',
        items: {
          type: 'object',
          properties: {
            kind: { type: 'string', enum: ['bullets', 'two_column'] },
            title: { type: 'string', description: 'Slide headline stating the point, max 10 words.' },
            bullets: { type: 'array', items: { type: 'string' }, description: 'For bullets slides: 2–6 bullets, each under 18 words.' },
            left: { type: 'object', properties: { heading: { type: 'string' }, bullets: { type: 'array', items: { type: 'string' } } } },
            right: { type: 'object', properties: { heading: { type: 'string' }, bullets: { type: 'array', items: { type: 'string' } } } },
          },
          required: ['kind', 'title'],
        },
      },
    },
    required: ['title', 'subtitle', 'slides'],
  },
} as const;

export function deckSystemPrompt(kind: DeckKind, audience: string | null): string {
  return [
    'You turn verified meeting notes into a clear slide deck.',
    `Deck type: ${DECK_KINDS[kind].brief}`,
    audience ? `Audience: ${audience}` : '',
    'Rules:',
    '- Use only facts in the material. Never invent numbers, dates, prices, names or commitments. If something a deck like this would normally include is missing, leave it out.',
    '- Each slide title states the point ("Foundation pour moved to Oct 22"), not a topic ("Schedule").',
    '- Short, concrete bullets. No filler, no marketing language.',
  ]
    .filter(Boolean)
    .join('\n');
}

/** Clean model output: drop empty slides, trim overly long lists. */
export function sanitizeSlides(raw: unknown): NarrativeSlide[] {
  const out: NarrativeSlide[] = [];
  for (const s of Array.isArray(raw) ? raw : []) {
    const title = String(s?.title ?? '').trim();
    if (!title) continue;
    const clean = (b: unknown) => (Array.isArray(b) ? b.map((x) => String(x).trim()).filter(Boolean) : []);
    if (s.kind === 'two_column' && s.left && s.right) {
      const left = { heading: String(s.left.heading ?? '').trim(), bullets: clean(s.left.bullets).slice(0, 6) };
      const right = { heading: String(s.right.heading ?? '').trim(), bullets: clean(s.right.bullets).slice(0, 6) };
      if (left.bullets.length || right.bullets.length) out.push({ kind: 'two_column', title, left, right });
    } else {
      const bullets = clean(s.bullets);
      if (bullets.length) out.push({ kind: 'bullets', title, bullets: bullets.slice(0, 7) });
    }
  }
  return out.slice(0, 8);
}

const C = { ink: '1A1C1A', muted: '6B6F6A', accent: '1F6F5C', soft: 'E3EFEB', line: 'E4E1DA', bg: 'FFFFFF' };
const FONT = 'Calibri';
const W = 13.333;

function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

export async function buildPptx(d: DeckData): Promise<Uint8Array> {
  const p = new PptxGen();
  p.layout = 'LAYOUT_WIDE'; // 13.333 x 7.5 in
  p.title = d.title;

  p.defineSlideMaster({
    title: 'BODY',
    background: { color: C.bg },
    objects: [
      { rect: { x: 0, y: 0, w: W, h: 0.12, fill: { color: C.accent } } },
      { line: { x: 0.6, y: 6.95, w: W - 1.2, h: 0, line: { color: C.line, width: 0.75 } } },
      { text: { text: d.footer, options: { x: 0.6, y: 7.0, w: 9, h: 0.35, fontFace: FONT, fontSize: 10, color: C.muted } } },
    ],
    slideNumber: { x: W - 1.2, y: 7.0, w: 0.6, h: 0.35, fontFace: FONT, fontSize: 10, color: C.muted, align: 'right' },
  });

  const heading = (s: Slide, text: string) =>
    s.addText(text, { x: 0.6, y: 0.45, w: W - 1.2, h: 0.9, fontFace: FONT, fontSize: 28, bold: true, color: C.ink, valign: 'top', fit: 'shrink' });

  const bullets = (s: Slide, items: string[], x: number, y: number, w: number, h: number, size = 20) =>
    s.addText(
      items.map((b) => ({ text: b, options: { bullet: { code: '25A0' }, paraSpaceAfter: 10 } })),
      { x, y, w, h, fontFace: FONT, fontSize: size, color: C.ink, valign: 'top', fit: 'shrink' },
    );

  // Title slide
  const title = p.addSlide();
  title.background = { color: C.accent };
  title.addText(d.title, { x: 0.8, y: 2.3, w: W - 1.6, h: 1.4, fontFace: FONT, fontSize: 44, bold: true, color: 'FFFFFF', valign: 'bottom', fit: 'shrink' });
  title.addText(d.subtitle, { x: 0.8, y: 3.8, w: W - 1.6, h: 0.8, fontFace: FONT, fontSize: 20, color: C.soft, valign: 'top' });

  for (const sl of d.slides) {
    const s = p.addSlide({ masterName: 'BODY' });
    heading(s, sl.title);
    if (sl.kind === 'bullets') {
      bullets(s, sl.bullets, 0.6, 1.55, W - 1.2, 5.2);
    } else {
      const colW = (W - 1.2 - 0.5) / 2;
      [sl.left, sl.right].forEach((col, i) => {
        const x = 0.6 + i * (colW + 0.5);
        s.addShape(p.ShapeType.rect, { x, y: 1.55, w: colW, h: 0.55, fill: { color: C.soft }, line: { color: C.soft } });
        s.addText(col.heading, { x: x + 0.15, y: 1.55, w: colW - 0.3, h: 0.55, fontFace: FONT, fontSize: 16, bold: true, color: C.accent, valign: 'middle' });
        bullets(s, col.bullets, x, 2.25, colW, 4.5, 18);
      });
    }
  }

  // Safety, straight from the verified site log
  if (d.safety?.length) {
    for (const [i, page] of chunk(d.safety, 6).entries()) {
      const s = p.addSlide({ masterName: 'BODY' });
      heading(s, i === 0 ? 'Safety items' : 'Safety items (continued)');
      s.addShape(p.ShapeType.rect, { x: 0.6, y: 1.45, w: 0.12, h: 5.3, fill: { color: 'C2412D' }, line: { color: 'C2412D' } });
      bullets(s, page.map((x) => (x.location ? `${x.text} (${x.location})` : x.text)), 0.95, 1.55, W - 1.55, 5.2);
    }
  }

  // Photos with what was being said when they were taken
  for (const ph of (d.photos ?? []).slice(0, 12)) {
    const s = p.addSlide({ masterName: 'BODY' });
    const box = fitImage(ph.width, ph.height, { x: 0.6, y: 0.5, w: 7.9, h: 6.2 });
    s.addImage({ data: ph.dataUri, ...box });
    const x = 8.9;
    const w = W - x - 0.6;
    s.addText(ph.caption, { x, y: 0.6, w, h: 1.25, fontFace: FONT, fontSize: 22, bold: true, color: C.ink, valign: 'top', fit: 'shrink' });
    if (ph.detail) s.addText(ph.detail, { x, y: 1.9, w, h: 0.5, fontFace: FONT, fontSize: 15, color: C.accent, bold: true, valign: 'top' });
    if (ph.quote) s.addText(`“${ph.quote}”`, { x, y: 2.45, w, h: 4.0, fontFace: FONT, fontSize: 15, italic: true, color: C.muted, valign: 'top', fit: 'shrink' });
  }

  // Decisions, straight from the verified notes
  for (const [i, page] of chunk(d.decisions, 4).entries()) {
    const s = p.addSlide({ masterName: 'BODY' });
    heading(s, i === 0 ? 'Decisions' : 'Decisions (continued)');
    s.addText(
      page.flatMap((dec) => [
        { text: dec.text, options: { bold: true, breakLine: true, fontSize: 22, color: C.ink, paraSpaceBefore: 6 } },
        ...(dec.quote ? [{ text: `“${dec.quote}”`, options: { italic: true, breakLine: true, fontSize: 15, color: C.muted, paraSpaceAfter: 14 } }] : []),
      ]),
      { x: 0.6, y: 1.55, w: W - 1.2, h: 5.2, fontFace: FONT, valign: 'top' },
    );
  }

  // Action items, straight from the verified tasks
  const header = ['Action', 'Owner', 'Due', 'Status'].map((h) => ({
    text: h,
    options: { bold: true, color: 'FFFFFF', fill: { color: C.accent }, fontSize: 16 },
  }));
  for (const [i, page] of chunk(d.tasks, 7).entries()) {
    const s = p.addSlide({ masterName: 'BODY' });
    heading(s, i === 0 ? 'Next steps' : 'Next steps (continued)');
    const rows = page.map((t) => [
      { text: t.text, options: { fontSize: 16, color: C.ink } },
      { text: t.owner ?? '—', options: { fontSize: 16, color: t.owner ? C.ink : C.muted } },
      { text: t.due ?? '—', options: { fontSize: 16, color: t.due ? C.ink : C.muted } },
      { text: t.status === 'done' ? 'Done' : 'Open', options: { fontSize: 16, color: t.status === 'done' ? C.accent : C.ink, bold: t.status === 'done' } },
    ]);
    s.addTable([header, ...rows], {
      x: 0.6, y: 1.55, w: W - 1.2, colW: [7.2, 2.2, 1.6, 1.133], fontFace: FONT,
      border: { type: 'solid', pt: 0.5, color: C.line }, valign: 'middle', rowH: 0.62, margin: 0.08, autoPage: false,
    });
  }

  if (d.questions.length) {
    const s = p.addSlide({ masterName: 'BODY' });
    heading(s, 'Open questions');
    bullets(s, d.questions.slice(0, 7), 0.6, 1.55, W - 1.2, 5.2);
  }

  return (await p.write({ outputType: 'uint8array' })) as Uint8Array;
}
