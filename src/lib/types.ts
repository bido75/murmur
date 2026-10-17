export type Template = 'general' | 'meeting' | 'lecture' | 'phone_call' | 'site_walk' | 'sales_call' | 'interview';

export type RecordingStatus = 'scheduled' | 'recording' | 'uploading' | 'transcribing' | 'summarizing' | 'ready' | 'failed' | 'cancelled';

export type ConsentMethod = 'told_everyone' | 'in_invite' | 'solo' | 'consent_link' | 'bot_announced' | 'not_confirmed';

export type Project = {
  id: string;
  name: string;
  archived: boolean;
  vocabulary?: string[];
  created_at: string;
  workspace_id?: string | null;
  workspaces?: { name: string } | null;
};

export type Role = 'owner' | 'admin' | 'member';
export type Workspace = { id: string; name: string; role: Role };
export type Member = { user_id: string; role: Role; email: string | null; joined_at: string };
export type Invite = { id: string; email: string; role: Role; code: string; created_at: string; expires_at: string };

export type Recording = {
  id: string;
  user_id?: string;
  project_id?: string | null;
  consent_method?: ConsentMethod;
  consent_confirmed_at?: string | null;
  title: string;
  template: Template;
  source: 'mic' | 'import' | 'link' | 'bot' | 'phone' | 'aircall' | 'extension' | 'watch' | 'screen';
  has_video?: boolean;
  transcribed_on_device?: boolean;
  status: RecordingStatus;
  custom_template_id?: string | null;
  audio_deleted_at?: string | null;
  user_notes?: string | null;
  duration_ms: number;
  error: string | null;
  created_at: string;
};

export type Utterance = { start_ms: number; end_ms: number; speaker: number; text: string };

export type Transcript = { utterances: Utterance[]; speaker_names: Record<string, string> };

export type Decision = { text: string; quote: string; quote_ms: number | null; verified: boolean };

export type TaskUpdate = {
  task_id: string;
  text: string;
  status: 'done' | 'in_progress' | 'blocked';
  note: string | null;
  quote: string | null;
  quote_ms: number | null;
  verified: boolean;
};

export type Summary = {
  overview: string;
  key_points: string[];
  decisions: Decision[];
  open_questions: string[];
  task_updates?: TaskUpdate[];
  site_log?: SiteLog | null;
  site_log_external?: { procore?: { id: string; url: string } } | null;
};

type Proof = { quote: string; quote_ms: number | null; verified: boolean; photo_ids: string[] };
export type SiteCategory = 'safety' | 'quality' | 'schedule' | 'other';
export type SiteLog = {
  weather: ({ text: string } & Proof) | null;
  manpower: ({ company_or_trade: string; count: number | null } & Proof)[];
  work_completed: ({ text: string; location: string | null } & Proof)[];
  issues: ({ text: string; location: string | null; category: SiteCategory } & Proof)[];
  deliveries: ({ text: string } & Proof)[];
  inspections: ({ text: string; result: string | null } & Proof)[];
  delays: ({ text: string } & Proof)[];
};

export type Photo = {
  id: string;
  recording_id: string;
  storage_path: string;
  taken_ms: number | null;
  caption: string | null;
  width: number | null;
  height: number | null;
  created_at: string;
  /** Signed URL, or a local file while the photo waits to upload. */
  url?: string | null;
  pending?: boolean;
};

export type Provider = 'asana' | 'linear' | 'jira' | 'procore' | 'monday' | 'clickup' | 'trello' | 'hubspot' | 'salesforce';
/** Everything that can be connected: trackers plus places notes can go. */
export type ConnKey = Provider | 'slack' | 'notion' | 'google_docs' | 'onenote' | 'aircall';
export type External = Partial<Record<Provider, { id: string; key: string | null; url: string }>>;
export type Integration = { provider: ConnKey; config: { account?: string; target?: { id: string; name: string }; site?: string; email?: string; instance_url?: string } };

export const PROVIDER_LABELS: Record<ConnKey, string> = {
  asana: 'Asana', linear: 'Linear', jira: 'Jira', procore: 'Procore', monday: 'Monday.com', clickup: 'ClickUp', trello: 'Trello',
  hubspot: 'HubSpot', salesforce: 'Salesforce', slack: 'Slack', notion: 'Notion', google_docs: 'Google Docs', onenote: 'OneNote', aircall: 'Aircall',
};
export const TRACKERS: Provider[] = ['asana', 'linear', 'jira', 'monday', 'clickup', 'trello', 'hubspot', 'salesforce', 'procore'];

export const CONSENT_LABELS: Record<ConsentMethod, string> = {
  told_everyone: 'Told everyone at the start',
  in_invite: 'Notice was in the invite or agenda',
  solo: 'Only my own voice (notes to self)',
  consent_link: 'Everyone agreed through the consent link',
  bot_announced: 'Notetaker announced itself in the meeting',
  not_confirmed: 'Not confirmed',
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
  external?: External;
  progress_note?: string | null;
  completion_quote?: string | null;
  completed_by_recording_id?: string | null;
  photo_ids?: string[];
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
  scheduled: 'Notetaker scheduled',
  cancelled: 'Cancelled',
  recording: 'Recording',
  uploading: 'Uploading',
  transcribing: 'Transcribing',
  summarizing: 'Writing notes',
  ready: 'Ready',
  failed: 'Failed',
};

export type CalProvider = 'google' | 'microsoft';
export type CalendarEvent = {
  key: string;
  id: string;
  provider: CalProvider;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  meetingUrl: string | null;
  platform: 'zoom' | 'meet' | 'teams' | 'webex' | null;
  attendees: { name: string | null; email: string }[];
  location: string | null;
  recurring: boolean;
  match: { project_id: string; how: 'linked' | 'title' } | null;
};
export const CAL_LABELS: Record<CalProvider, string> = { google: 'Google Calendar', microsoft: 'Microsoft 365 / Outlook' };

export type SummaryTemplate = { id: string; name: string; instructions: string; base: Template; workspace_id: string | null; user_id: string };

export type ShareLink = {
  id: string;
  token: string;
  include_transcript: boolean;
  created_at: string;
  expires_at: string | null;
  revoked_at: string | null;
  views: number;
  allow_audio: boolean;
  allow_questions: boolean;
  has_password: boolean;
  clip_start_ms: number | null;
  clip_end_ms: number | null;
  title: string | null;
};

export type ConsentResponse = { id: string; name: string; email: string | null; decision: 'agree' | 'decline'; created_at: string };

export type MeetingBot = { status: string; status_detail: string | null; meeting_url: string; join_at: string | null };
