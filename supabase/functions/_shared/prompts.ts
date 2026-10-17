// Prompts and the structured-output schema for summaries. Pure data, testable anywhere.
import { SITE_LOG_RULES, SITE_LOG_SCHEMA, type RawSiteLog } from './field.ts';

export const TEMPLATES = {
  general: 'A general conversation or voice note.',
  meeting: 'A team or client meeting. Focus on decisions made, who owns which next step, and deadlines.',
  lecture: 'A lecture or class. Key points should read as study notes: concepts, definitions, examples. Action items are assignments or readings, if any.',
  phone_call: 'A phone call. Capture what each side asked for and agreed to, and any follow-up.',
  site_walk:
    'A construction or field site walk. Key points should list issues and observations with their location (floor, room, grid line, area) when said. Include safety issues explicitly. Action items are fixes, inspections, orders and RFIs.',
  sales_call: 'A sales call. Capture the customer\'s needs, objections, budget and timeline if said, and agreed next steps.',
  interview: 'An interview. Summarize answers by topic; action items are follow-ups only.',
} as const;

export type TemplateId = keyof typeof TEMPLATES;

export function systemPrompt(template: string, custom: string | null = null): string {
  const focus = TEMPLATES[(template as TemplateId)] ?? TEMPLATES.general;
  return [
    'You turn conversation transcripts into accurate, useful notes.',
    `Context: ${focus}`,
    ...(custom?.trim()
      ? [
          '',
          'The user’s own instructions for how these notes should look (follow them for structure, emphasis and wording, but never break the rules below):',
          '<user_template>',
          custom.trim().slice(0, 4000),
          '</user_template>',
          'Put sections the instructions ask for into key_points, prefixed with the section name and a colon (e.g. "Budget: ...").',
        ]
      : []),
    '',
    'Rules for action items (these matter most):',
    '- Only include something as an action item if a person committed to it, was asked to do it and did not refuse, or it was clearly assigned. Ideas floated with "we could", "maybe", "what if" are kind "suggestion", never "commitment".',
    '- "quote" must be copied word for word from the transcript (without the timestamp or speaker label), 5 to 25 words, from the line where the commitment or assignment was made. Never paraphrase it.',
    '- Set owner only when a name is said for that task (owner_basis "named") or the speaker takes it on themselves (owner_basis "self_assigned", owner = that speaker\'s label). Otherwise owner null and owner_basis "unassigned". Never guess.',
    '- "due" is the deadline exactly as said ("Thursday", "end of month"), or null.',
    '',
    'Rules for everything else:',
    '- Write in the language spoken in the transcript.',
    '- Do not invent facts, names, numbers or dates. If something is unclear, put it in open_questions.',
    '- Decisions also need a word-for-word quote.',
    '- Keep the overview to 2–4 sentences. Key points are short bullets.',
    '',
    'If a list of open tasks from earlier recordings is given:',
    '- Report in task_updates only the ones actually discussed: status "done" if someone says it is finished, "in_progress" or "blocked" otherwise, with a word-for-word quote. Leave the rest out.',
    '- Do not add an open task again as a new action item.',
    ...(template === 'site_walk' ? [SITE_LOG_RULES] : []),
  ].join('\n');
}

export function userMessage(transcript: string, openTasks: { ref: string; text: string }[], userNotes: string | null = null): string {
  const parts = [];
  if (userNotes?.trim()) {
    parts.push('Notes the user typed during the meeting (treat these as what mattered most to them: cover every point, expand each with details from the transcript, keep their wording where it fits, and never add anything the transcript does not support):');
    parts.push('<user_notes>', userNotes.trim().slice(0, 20000), '</user_notes>', '');
  }
  if (openTasks.length) {
    parts.push('Open tasks from earlier recordings in this project:');
    parts.push(...openTasks.map((t) => `${t.ref}: ${t.text}`));
    parts.push('');
  }
  parts.push('Transcript:', '', transcript);
  return parts.join('\n');
}

export const NOTES_TOOL = {
  name: 'record_notes',
  description: 'Record the structured notes for this transcript.',
  input_schema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Short title, max 8 words.' },
      overview: { type: 'string' },
      key_points: { type: 'array', items: { type: 'string' } },
      decisions: {
        type: 'array',
        items: {
          type: 'object',
          properties: { text: { type: 'string' }, quote: { type: 'string' } },
          required: ['text', 'quote'],
        },
      },
      action_items: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            task: { type: 'string', description: 'Imperative, e.g. "Send revised quote to client".' },
            owner: { type: ['string', 'null'] },
            owner_basis: { type: 'string', enum: ['named', 'self_assigned', 'unassigned'] },
            due: { type: ['string', 'null'] },
            kind: { type: 'string', enum: ['commitment', 'suggestion'] },
            quote: { type: 'string' },
          },
          required: ['task', 'owner', 'owner_basis', 'due', 'kind', 'quote'],
        },
      },
      open_questions: { type: 'array', items: { type: 'string' } },
      task_updates: {
        type: 'array',
        description: 'Updates to the earlier open tasks listed, if any were discussed.',
        items: {
          type: 'object',
          properties: {
            ref: { type: 'string', description: 'The task ref, e.g. "T3".' },
            status: { type: 'string', enum: ['done', 'in_progress', 'blocked'] },
            note: { type: ['string', 'null'] },
            quote: { type: 'string' },
          },
          required: ['ref', 'status', 'note', 'quote'],
        },
      },
    },
    required: ['title', 'overview', 'key_points', 'decisions', 'action_items', 'open_questions', 'task_updates'],
  },
} as const;

/** The notes tool for a template: site walks also fill in a daily site log. */
export function notesTool(template: string) {
  if (template !== 'site_walk') return NOTES_TOOL;
  return {
    ...NOTES_TOOL,
    input_schema: {
      ...NOTES_TOOL.input_schema,
      properties: { ...NOTES_TOOL.input_schema.properties, site_log: SITE_LOG_SCHEMA },
      required: [...NOTES_TOOL.input_schema.required, 'site_log'],
    },
  };
}

export type NotesOutput = {
  title: string;
  overview: string;
  key_points: string[];
  decisions: { text: string; quote: string }[];
  action_items: {
    task: string;
    owner: string | null;
    owner_basis: 'named' | 'self_assigned' | 'unassigned';
    due: string | null;
    kind: 'commitment' | 'suggestion';
    quote: string;
  }[];
  open_questions: string[];
  task_updates?: { ref: string; status: 'done' | 'in_progress' | 'blocked'; note: string | null; quote: string }[];
  site_log?: RawSiteLog | null;
};

export const ASK_SYSTEM = [
  'You answer questions about the user\'s recorded conversations using only the material provided.',
  'Cite where each fact came from as (Recording title, m:ss). If the material does not contain the answer, say so plainly.',
  'Be brief: a direct answer first, then supporting detail only if useful.',
].join('\n');
