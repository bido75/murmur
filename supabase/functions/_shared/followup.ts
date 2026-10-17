// Follow-up email drafts, written only from confirmed notes. Pure; tested.
import type { PublicNotes } from './share.ts';

export const FOLLOWUP_TOOL = {
  name: 'write_email',
  description: 'Write the follow-up email.',
  input_schema: {
    type: 'object',
    properties: {
      subject: { type: 'string', description: 'Short subject line.' },
      body: { type: 'string', description: 'Plain-text email body, ready to send. No placeholders except [Your name] at the end.' },
    },
    required: ['subject', 'body'],
  },
} as const;

export function followupSystem(tone: 'friendly' | 'formal'): string {
  return [
    'You write the follow-up email the organizer sends to attendees after a meeting.',
    `Tone: ${tone === 'formal' ? 'formal and concise' : 'warm, direct and concise'}.`,
    'Rules:',
    '- Use only the material given. Never invent commitments, dates, prices or names.',
    '- Open with one line of thanks or context, then the decisions, then next steps as a list with owner and due date when given.',
    '- Keep it under 200 words unless the material needs more. Plain text, no markdown headings.',
    '- Write in the language of the material.',
    '- End with "[Your name]" on its own line.',
  ].join('\n');
}

export function followupMaterial(n: PublicNotes, sender: string | null): string {
  const lines = [`Meeting: ${n.title} (${n.date.slice(0, 10)})`];
  if (sender) lines.push(`Sender: ${sender}`);
  if (n.overview) lines.push('', `Summary: ${n.overview}`);
  if (n.decisions.length) lines.push('', 'Decisions:', ...n.decisions.map((d) => `- ${d.text}`));
  const open = n.tasks.filter((t) => !t.done);
  if (open.length) lines.push('', 'Next steps:', ...open.map((t) => `- ${t.text}${t.owner ? ` (owner: ${t.owner})` : ''}${t.due ? ` (due: ${t.due})` : ''}`));
  if (n.open_questions.length) lines.push('', 'Open questions:', ...n.open_questions.map((q) => `- ${q}`));
  return lines.join('\n');
}
