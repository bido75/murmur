// Renders a .pptx from a deck spec using pptxgenjs. The pure planning logic (types,
// themes, tool schema, prompt, chart validation, slide sanitization) lives in
// deck_plan.ts and is re-exported here for callers that import from deck.ts.
import pptxgenModule from 'npm:pptxgenjs@3';
import {
  fitImage,
  THEMES,
  type BulletSlide,
  type ChartSlide,
  type DeckData,
  type DeckTheme,
  type EditorialSlide,
  type KpiSlide,
  type PillarsSlide,
  type ProcessSlide,
  type TimelineSlide,
  type TwoColumnSlide,
} from './deck_plan.ts';

export * from './deck_plan.ts';

// pptxgenjs ships CommonJS types that Deno can't see as a constructor; the runtime
// default export is the class. Typed loosely here, exercised by the render check.
// deno-lint-ignore no-explicit-any
type Pptx = any;
// deno-lint-ignore no-explicit-any
type Slide = any;
const PptxGen = pptxgenModule as unknown as new () => Pptx;

const W = 13.333;

function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

const CHART_TYPES = { bar: 'bar', line: 'line', doughnut: 'doughnut' } as const;

export async function buildPptx(d: DeckData, opts: { theme?: DeckTheme } = {}): Promise<Uint8Array> {
  const C = opts.theme ?? THEMES.corporate;
  const FONT = C.font;
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
      items.map((b) => ({ text: b, options: { bullet: { code: '25A0', color: C.accent }, paraSpaceAfter: 10 } })),
      { x, y, w, h, fontFace: FONT, fontSize: size, color: C.ink, valign: 'top', fit: 'shrink' },
    );

  const bodyTop = 1.55;
  const bodyH = 5.2;

  // Title slide
  const title = p.addSlide();
  title.background = { color: C.accent };
  title.addText(d.title, { x: 0.8, y: 2.3, w: W - 1.6, h: 1.4, fontFace: FONT, fontSize: 44, bold: true, color: C.onAccent, valign: 'bottom', fit: 'shrink' });
  title.addText(d.subtitle, { x: 0.8, y: 3.8, w: W - 1.6, h: 0.8, fontFace: FONT, fontSize: 20, color: C.onAccent, valign: 'top' });

  for (const sl of d.slides) {
    const s = p.addSlide({ masterName: 'BODY' });
    switch (sl.kind) {
      case 'bullets':
        heading(s, sl.title);
        bullets(s, sl.bullets, 0.6, bodyTop, W - 1.2, bodyH);
        break;
      case 'two_column':
        heading(s, sl.title);
        renderTwoColumn(p, s, sl, C, FONT, bodyTop);
        break;
      case 'process':
        heading(s, sl.title);
        renderProcess(p, s, sl, C, FONT);
        break;
      case 'timeline':
        heading(s, sl.title);
        renderTimeline(p, s, sl, C, FONT);
        break;
      case 'pillars':
        heading(s, sl.title);
        renderPillars(p, s, sl, C, FONT);
        break;
      case 'chart':
        heading(s, sl.title);
        renderChart(p, s, sl, C, FONT);
        break;
      case 'kpi':
        heading(s, sl.title);
        renderKpi(p, s, sl, C, FONT);
        break;
      case 'editorial':
        renderEditorial(s, sl, C, FONT);
        break;
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
    options: { bold: true, color: C.onAccent, fill: { color: C.accent }, fontSize: 16 },
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

// ---------- Native diagram renderers (all editable shapes, no flattened images) ----------

function renderTwoColumn(p: Pptx, s: Slide, sl: TwoColumnSlide, C: DeckTheme, FONT: string, top: number) {
  const colW = (W - 1.2 - 0.5) / 2;
  [sl.left, sl.right].forEach((col, i) => {
    const x = 0.6 + i * (colW + 0.5);
    s.addShape(p.ShapeType.rect, { x, y: top, w: colW, h: 0.55, fill: { color: C.soft }, line: { color: C.soft } });
    s.addText(col.heading, { x: x + 0.15, y: top, w: colW - 0.3, h: 0.55, fontFace: FONT, fontSize: 16, bold: true, color: C.accent, valign: 'middle' });
    s.addText(
      col.bullets.map((b) => ({ text: b, options: { bullet: { code: '25A0', color: C.accent }, paraSpaceAfter: 8 } })),
      { x, y: top + 0.75, w: colW, h: 4.4, fontFace: FONT, fontSize: 17, color: C.ink, valign: 'top', fit: 'shrink' },
    );
  });
}

function renderProcess(p: Pptx, s: Slide, sl: ProcessSlide, C: DeckTheme, FONT: string) {
  const n = sl.steps.length;
  const gap = 0.35;
  const boxW = (W - 1.2 - gap * (n - 1)) / n;
  sl.steps.forEach((step, i) => {
    const x = 0.6 + i * (boxW + gap);
    const y = 2.0;
    const boxH = 3.2;
    s.addShape(p.ShapeType.roundRect, { x, y, w: boxW, h: boxH, fill: { color: i % 2 ? C.soft : 'FFFFFF' }, line: { color: C.accent, width: 1 } });
    s.addText(String(i + 1), { x, y: y + 0.25, w: boxW, h: 0.5, fontFace: FONT, fontSize: 26, bold: true, color: C.accent, align: 'center' });
    s.addText(step.heading, { x: x + 0.15, y: y + 0.85, w: boxW - 0.3, h: 1.0, fontFace: FONT, fontSize: 17, bold: true, color: C.ink, align: 'center', valign: 'top', fit: 'shrink' });
    if (step.detail) s.addText(step.detail, { x: x + 0.15, y: y + 1.95, w: boxW - 0.3, h: 1.1, fontFace: FONT, fontSize: 13, color: C.muted, align: 'center', valign: 'top', fit: 'shrink' });
    if (i < n - 1) s.addText('→', { x: x + boxW, y: y + 1.3, w: gap, h: 0.6, fontFace: FONT, fontSize: 22, bold: true, color: C.accent, align: 'center' });
  });
}

function renderTimeline(p: Pptx, s: Slide, sl: TimelineSlide, C: DeckTheme, FONT: string) {
  const y = 3.4;
  s.addShape(p.ShapeType.line, { x: 0.9, y, w: W - 1.8, h: 0, line: { color: C.accent, width: 2 } });
  const n = sl.milestones.length;
  const step = (W - 1.8) / (n - 1);
  sl.milestones.forEach((m, i) => {
    const x = 0.9 + i * step;
    s.addShape(p.ShapeType.ellipse, { x: x - 0.12, y: y - 0.12, w: 0.24, h: 0.24, fill: { color: C.accent }, line: { color: C.accent } });
    const above = i % 2 === 0;
    const ly = above ? y - 1.7 : y + 0.35;
    s.addText(m.label, { x: x - 0.85, y: ly, w: 1.7, h: 0.5, fontFace: FONT, fontSize: 15, bold: true, color: C.ink, align: 'center', fit: 'shrink' });
    if (m.note) s.addText(m.note, { x: x - 1.0, y: ly + 0.5, w: 2.0, h: 0.9, fontFace: FONT, fontSize: 12, color: C.muted, align: 'center', valign: 'top', fit: 'shrink' });
  });
}

function renderPillars(p: Pptx, s: Slide, sl: PillarsSlide, C: DeckTheme, FONT: string) {
  const n = sl.pillars.length;
  const gap = 0.4;
  const boxW = (W - 1.2 - gap * (n - 1)) / n;
  sl.pillars.forEach((pill, i) => {
    const x = 0.6 + i * (boxW + gap);
    const y = 1.8;
    const boxH = 4.4;
    s.addShape(p.ShapeType.rect, { x, y, w: boxW, h: 0.18, fill: { color: C.accent }, line: { color: C.accent } });
    s.addShape(p.ShapeType.rect, { x, y: y + 0.18, w: boxW, h: boxH - 0.18, fill: { color: C.soft }, line: { color: C.line, width: 0.75 } });
    s.addText(pill.heading, { x: x + 0.2, y: y + 0.45, w: boxW - 0.4, h: 1.0, fontFace: FONT, fontSize: 17, bold: true, color: C.ink, align: 'center', valign: 'top', fit: 'shrink' });
    if (pill.detail) s.addText(pill.detail, { x: x + 0.2, y: y + 1.6, w: boxW - 0.4, h: 2.6, fontFace: FONT, fontSize: 13, color: C.muted, align: 'center', valign: 'top', fit: 'shrink' });
  });
}

function renderKpi(p: Pptx, s: Slide, sl: KpiSlide, C: DeckTheme, FONT: string) {
  const n = sl.metrics.length;
  const gap = 0.4;
  const boxW = (W - 1.2 - gap * (n - 1)) / n;
  sl.metrics.forEach((m, i) => {
    const x = 0.6 + i * (boxW + gap);
    const y = 2.0;
    s.addShape(p.ShapeType.roundRect, { x, y, w: boxW, h: 3.0, fill: { color: C.soft }, line: { color: C.line, width: 0.75 } });
    s.addText(m.value, { x: x + 0.2, y: y + 0.4, w: boxW - 0.4, h: 1.2, fontFace: FONT, fontSize: 34, bold: true, color: C.accent, align: 'center', valign: 'middle', fit: 'shrink' });
    s.addText(m.label, { x: x + 0.2, y: y + 1.75, w: boxW - 0.4, h: 1.0, fontFace: FONT, fontSize: 14, color: C.ink, align: 'center', valign: 'top', fit: 'shrink' });
  });
}

function renderChart(p: Pptx, s: Slide, sl: ChartSlide, C: DeckTheme, FONT: string) {
  const type = CHART_TYPES[sl.chartType];
  const series = (type === 'doughnut' ? sl.series.slice(0, 1) : sl.series).map((sr) => ({ name: sr.name, labels: sl.categories, values: sr.values }));
  if (!series.length) return;
  s.addChart(p.ChartType[type], series, {
    x: 0.8, y: 1.5, w: W - 1.6, h: 5.0,
    chartColors: [C.accent, C.muted, C.soft],
    showTitle: false, showLegend: type !== 'doughnut', legendPos: 'b', legendFontFace: FONT, legendFontSize: 12, legendColor: C.muted,
    catAxisLabelColor: C.muted, catAxisLabelFontFace: FONT, catAxisLabelFontSize: 11,
    valAxisLabelColor: C.muted, valAxisLabelFontFace: FONT, valAxisLabelFontSize: 11, valGridLine: { color: C.line },
    dataLabelColor: C.ink, dataLabelFontFace: FONT, dataLabelFontSize: 11, showValue: type !== 'line',
    barGapWidthPct: 40,
  });
}

function renderEditorial(s: Slide, sl: EditorialSlide, C: DeckTheme, FONT: string) {
  s.addText(sl.statement, { x: 1.4, y: 2.3, w: W - 2.8, h: 2.0, fontFace: FONT, fontSize: 34, bold: true, color: C.ink, align: 'center', valign: 'middle', fit: 'shrink' });
  s.addText(sl.title, { x: 1.4, y: 4.6, w: W - 2.8, h: 0.6, fontFace: FONT, fontSize: 16, color: C.muted, align: 'center' });
}