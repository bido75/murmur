// Word (.docx) export of a recording's notes. Built from the same confirmed material as a share link.
import { AlignmentType, BorderStyle, Document, HeadingLevel, Packer, Paragraph, ShadingType, Table, TableCell, TableRow, TextRun, WidthType } from 'npm:docx@9';
import type { PublicNotes } from './share.ts';

const ACCENT = '1F6F5C';
const MUTED = '6B6F6A';

function heading(text: string) {
  return new Paragraph({ text, heading: HeadingLevel.HEADING_2, spacing: { before: 280, after: 80 } });
}
function bullet(text: string) {
  return new Paragraph({ text, bullet: { level: 0 }, spacing: { after: 40 } });
}

export async function buildDocx(n: PublicNotes, o: { appName: string; dateLabel: string; consent?: string | null }): Promise<Uint8Array> {
  const children: (Paragraph | Table)[] = [
    new Paragraph({ text: n.title, heading: HeadingLevel.TITLE, spacing: { after: 60 } }),
    new Paragraph({ children: [new TextRun({ text: o.dateLabel, color: MUTED })], spacing: { after: 200 } }),
  ];
  if (n.overview) children.push(new Paragraph({ text: n.overview, spacing: { after: 120 } }));

  if (n.tasks.length) {
    children.push(heading('Action items'));
    const cell = (text: string, header = false, width = 25) =>
      new TableCell({
        width: { size: width, type: WidthType.PERCENTAGE },
        margins: { top: 60, bottom: 60, left: 100, right: 100 },
        shading: header ? { type: ShadingType.CLEAR, color: 'auto', fill: ACCENT } : undefined,
        children: [new Paragraph({ children: [new TextRun({ text, bold: header, color: header ? 'FFFFFF' : undefined })] })],
      });
    children.push(
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [
          new TableRow({ tableHeader: true, children: [cell('Action', true, 55), cell('Owner', true, 18), cell('Due', true, 15), cell('Status', true, 12)] }),
          ...n.tasks.map((t) => new TableRow({ children: [cell(t.text, false, 55), cell(t.owner ?? '—', false, 18), cell(t.due ?? '—', false, 15), cell(t.done ? 'Done' : 'Open', false, 12)] })),
        ],
      }),
    );
  }

  if (n.decisions.length) {
    children.push(heading('Decisions'));
    for (const d of n.decisions) {
      children.push(new Paragraph({ children: [new TextRun({ text: d.text, bold: true })], spacing: { before: 80 } }));
      if (d.quote) children.push(new Paragraph({ children: [new TextRun({ text: `“${d.quote}”`, italics: true, color: MUTED })], spacing: { after: 60 } }));
    }
  }

  if (n.site_log.length) {
    children.push(heading('Daily site log'));
    for (const s of n.site_log) {
      children.push(new Paragraph({ children: [new TextRun({ text: s.title, bold: true, color: s.title === 'Safety' ? 'C2412D' : ACCENT })], spacing: { before: 120, after: 40 } }));
      children.push(...s.items.map(bullet));
    }
  }

  if (n.key_points.length) {
    children.push(heading('Key points'));
    children.push(...n.key_points.map(bullet));
  }
  if (n.open_questions.length) {
    children.push(heading('Open questions'));
    children.push(...n.open_questions.map(bullet));
  }

  if (n.transcript?.length) {
    children.push(heading('Transcript'));
    let last = '';
    for (const line of n.transcript) {
      const runs = [];
      if (line.speaker !== last) runs.push(new TextRun({ text: `${line.speaker}  `, bold: true, color: ACCENT }), new TextRun({ text: `${line.at}`, color: MUTED, size: 18 }));
      children.push(
        ...(runs.length ? [new Paragraph({ children: runs, spacing: { before: 140 } })] : []),
        new Paragraph({ text: line.text, spacing: { after: 40 } }),
      );
      last = line.speaker;
    }
  }

  children.push(
    new Paragraph({
      border: { top: { style: BorderStyle.SINGLE, size: 4, color: 'E4E1DA', space: 8 } },
      spacing: { before: 400 },
      alignment: AlignmentType.LEFT,
      children: [
        new TextRun({
          text: `${o.consent ? `Recording notice: ${o.consent}. ` : ''}AI-generated notes, checked against the transcript. Exported from ${o.appName}.`,
          color: MUTED,
          size: 18,
        }),
      ],
    }),
  );

  const doc = new Document({
    creator: o.appName,
    title: n.title,
    styles: { default: { document: { run: { font: 'Calibri', size: 22 } } } },
    sections: [{ properties: {}, children }],
  });
  return new Uint8Array(await Packer.toBuffer(doc));
}
