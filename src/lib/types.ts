export type Template = 'general' | 'meeting' | 'lecture' | 'phone_call' | 'site_walk' | 'sales_call' | 'interview';

export type RecordingStatus = 'recording' | 'uploading' | 'transcribing' | 'summarizing' | 'ready' | 'failed';

export type Recording = {
  id: string;
  title: string;
  template: Template;
  source: 'mic' | 'import';
  status: RecordingStatus;
  duration_ms: number;
  error: string | null;
  created_at: string;
};

export type Utterance = { start_ms: number; end_ms: number; speaker: number; text: string };

export type Transcript = { utterances: Utterance[]; speaker_names: Record<string, string> };

export type Decision = { text: string; quote: string; quote_ms: number | null; verified: boolean };

export type Summary = {
  overview: string;
  key_points: string[];
  decisions: Decision[];
  open_questions: string[];
};

export type Task = {
  id: string;
  recording_id: string | null;
  text: string;
  owner: string | null;
  owner_basis: 'named' | 'self_assigned' | 'unassigned';
  due_text: string | null;
  due_date: string | null;
  kind: 'commitment' | 'suggestion';
  status: 'open' | 'done' | 'dismissed';
  quote: string | null;
  quote_ms: number | null;
  verified: boolean;
  needs_review: boolean;
  created_at: string;
};

export const TEMPLATE_LABELS: Record<Template, string> = {
  general: 'General',
  meeting: 'Meeting',
  lecture: 'Lecture',
  phone_call: 'Phone call',
  site_walk: 'Site walk',
  sales_call: 'Sales call',
  interview: 'Interview',
};

export const STATUS_LABELS: Record<RecordingStatus, string> = {
  recording: 'Recording',
  uploading: 'Uploading',
  transcribing: 'Transcribing',
  summarizing: 'Writing notes',
  ready: 'Ready',
  failed: 'Failed',
};
