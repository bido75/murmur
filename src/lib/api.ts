import AsyncStorage from '@react-native-async-storage/async-storage';
import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { isWeb } from './dialog';
import { downloadWeb } from './export';
import { uuid } from './format';
import { supabase } from './supabase';
import { enqueue, keepFile, pendingOps, processRecording, type CreateOp } from './sync';
import type { ConsentMethod, Integration, Project, Provider, Recording, Summary, Task, Template, Transcript } from './types';

/** Register a new recording locally; it syncs to the server when there's a connection. */
export async function newRecording(opts: {
  template: Template;
  source: 'mic' | 'import';
  consentAt: string | null;
  consentMethod?: ConsentMethod;
  projectId?: string | null;
  title?: string;
}) {
  const recordingId = uuid();
  await enqueue({
    kind: 'create',
    recordingId,
    title: opts.title ?? 'New recording',
    template: opts.template,
    source: opts.source,
    consentAt: opts.consentAt,
    consentMethod: opts.consentMethod,
    projectId: opts.projectId ?? null,
    createdAt: new Date().toISOString(),
  });
  return recordingId;
}

/** Pick an audio or video file and send it through the same pipeline as a recording. */
export async function importAudio(template: Template, projectId: string | null = null): Promise<string | null> {
  const res = await DocumentPicker.getDocumentAsync({ type: ['audio/*', 'video/*'], copyToCacheDirectory: true });
  if (res.canceled || !res.assets?.length) return null;
  const asset = res.assets[0];
  const ext = (asset.name.split('.').pop() || 'm4a').toLowerCase();
  const title = asset.name.replace(/\.[^.]+$/, '').slice(0, 80) || 'Imported audio';
  const recordingId = await newRecording({ template, source: 'import', consentAt: null, title, projectId });
  const localUri = keepFile(asset.uri, recordingId, 1, ext);
  await enqueue({ kind: 'segment', recordingId, idx: 1, localUri, ext, durationMs: 0 });
  await enqueue({ kind: 'finalize', recordingId, durationMs: 0 });
  return recordingId;
}

/** Recordings made offline that haven't reached the server yet. */
export async function localOnlyRecordings(): Promise<Recording[]> {
  const ops = await pendingOps();
  return ops
    .filter((o): o is CreateOp => o.kind === 'create')
    .map((o) => ({
      id: o.recordingId,
      title: o.title,
      template: o.template,
      source: o.source,
      status: 'uploading' as const,
      duration_ms: 0,
      error: o.lastError ?? null,
      created_at: o.createdAt,
    }));
}

export async function listRecordings(): Promise<Recording[]> {
  const { data, error } = await supabase
    .from('recordings')
    .select('id, title, template, source, status, duration_ms, error, created_at, project_id')
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) throw new Error(error.message);
  return (data ?? []) as Recording[];
}

export async function getRecording(id: string) {
  const [rec, tr, sum, tasks, segs] = await Promise.all([
    supabase.from('recordings').select('*').eq('id', id).maybeSingle(),
    supabase.from('transcripts').select('utterances, speaker_names').eq('recording_id', id).maybeSingle(),
    supabase.from('summaries').select('overview, key_points, decisions, open_questions, task_updates').eq('recording_id', id).maybeSingle(),
    supabase.from('tasks').select('*').eq('recording_id', id).neq('status', 'dismissed').order('created_at'),
    supabase.from('recording_segments').select('idx, storage_path, duration_ms').eq('recording_id', id).order('idx'),
  ]);
  return {
    recording: (rec.data ?? null) as Recording | null,
    transcript: (tr.data ?? null) as Transcript | null,
    summary: (sum.data ?? null) as Summary | null,
    tasks: (tasks.data ?? []) as Task[],
    segments: (segs.data ?? []) as { idx: number; storage_path: string; duration_ms: number }[],
  };
}

export async function retryProcessing(id: string) {
  await processRecording(id);
}

export async function renameRecording(id: string, title: string) {
  const { error } = await supabase.from('recordings').update({ title }).eq('id', id);
  if (error) throw new Error(error.message);
}

export async function deleteRecording(id: string) {
  const { data: segs } = await supabase.from('recording_segments').select('storage_path').eq('recording_id', id);
  const paths = (segs ?? []).map((s) => s.storage_path);
  if (paths.length) await supabase.storage.from('audio').remove(paths);
  const { error } = await supabase.from('recordings').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

export async function audioUrl(storagePath: string): Promise<string | null> {
  const { data } = await supabase.storage.from('audio').createSignedUrl(storagePath, 60 * 60);
  return data?.signedUrl ?? null;
}

export async function listTasks(filter: 'open' | 'review' | 'done'): Promise<(Task & { recordings: { title: string } | null })[]> {
  let q = supabase.from('tasks').select('*, recordings!tasks_recording_id_fkey(title)').order('created_at', { ascending: false }).limit(300);
  if (filter === 'open') q = q.eq('status', 'open').eq('needs_review', false);
  if (filter === 'review') q = q.eq('status', 'open').eq('needs_review', true);
  if (filter === 'done') q = q.eq('status', 'done');
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as (Task & { recordings: { title: string } | null })[];
}

export async function updateTask(id: string, patch: Partial<Pick<Task, 'status' | 'needs_review' | 'owner' | 'due_text' | 'text' | 'kind' | 'completed_by_recording_id' | 'completion_quote'>>) {
  const { error } = await supabase.from('tasks').update(patch).eq('id', id);
  if (error) throw new Error(error.message);
}

export async function ask(question: string, recordingId?: string): Promise<{ answer: string; sources: { recording_id: string; title: string }[] }> {
  const { data, error } = await supabase.functions.invoke('ask', { body: { question, recording_id: recordingId } });
  if (error) throw new Error(error.message);
  return data;
}

// Local settings
export type Settings = { consentReminder: boolean; defaultTemplate: Template };
const SETTINGS_KEY = 'settings.v1';
const DEFAULT_SETTINGS: Settings = { consentReminder: true, defaultTemplate: 'meeting' };

export async function getSettings(): Promise<Settings> {
  try {
    const raw = await AsyncStorage.getItem(SETTINGS_KEY);
    return raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export async function saveSettings(s: Settings) {
  await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
}

// ---------- Projects ----------

export async function listProjects(includeArchived = false): Promise<Project[]> {
  let q = supabase.from('projects').select('id, name, archived, created_at').order('created_at', { ascending: false });
  if (!includeArchived) q = q.eq('archived', false);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as Project[];
}

export async function createProject(name: string): Promise<Project> {
  const { data, error } = await supabase.from('projects').insert({ name: name.trim() }).select('id, name, archived, created_at').single();
  if (error) throw new Error(error.message);
  return data as Project;
}

export async function updateProject(id: string, patch: Partial<Pick<Project, 'name' | 'archived'>>) {
  const { error } = await supabase.from('projects').update(patch).eq('id', id);
  if (error) throw new Error(error.message);
}

export async function setRecordingProject(recordingId: string, projectId: string | null) {
  const { error } = await supabase.from('recordings').update({ project_id: projectId }).eq('id', recordingId);
  if (error) throw new Error(error.message);
}

type TaskWithSource = Task & { recordings: { title: string; project_id: string | null } | null };

/** Open, confirmed tasks across a project's recordings: the brief shown before the next meeting. */
export async function openProjectTasks(projectId: string): Promise<TaskWithSource[]> {
  const { data, error } = await supabase
    .from('tasks')
    .select('*, recordings!tasks_recording_id_fkey!inner(title, project_id)')
    .eq('recordings.project_id', projectId)
    .eq('status', 'open')
    .eq('needs_review', false)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) throw new Error(error.message);
  return (data ?? []) as TaskWithSource[];
}

export async function getProject(id: string) {
  const [proj, recs, tasks] = await Promise.all([
    supabase.from('projects').select('id, name, archived, created_at').eq('id', id).maybeSingle(),
    supabase.from('recordings').select('id, title, template, source, status, duration_ms, error, created_at, project_id').eq('project_id', id).order('created_at', { ascending: false }),
    openProjectTasks(id),
  ]);
  return { project: (proj.data ?? null) as Project | null, recordings: (recs.data ?? []) as Recording[], openTasks: tasks };
}

// ---------- Task trackers ----------

export async function listIntegrations(): Promise<Integration[]> {
  const { data, error } = await supabase.from('integrations').select('provider, config');
  if (error) throw new Error(error.message);
  return (data ?? []) as Integration[];
}

async function callFn<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) {
    // Surface the function's own error message when there is one.
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === 'function') {
      try {
        const j = await ctx.json();
        if (j?.error) throw new Error(j.error);
      } catch (inner) {
        if (inner instanceof Error && inner.message) throw inner;
      }
    }
    throw new Error(error.message);
  }
  if (data?.error) throw new Error(data.error);
  return data as T;
}

export function connectIntegration(provider: Provider, token: string, extra: { email?: string; site?: string } = {}) {
  return callFn<Integration>('integrations', { action: 'connect', provider, token, ...extra });
}

export async function integrationTargets(provider: Provider) {
  return (await callFn<{ targets: { id: string; name: string }[] }>('integrations', { action: 'targets', provider })).targets;
}

export function setIntegrationTarget(provider: Provider, target: { id: string; name: string }) {
  return callFn<Integration>('integrations', { action: 'set_target', provider, target });
}

export async function disconnectIntegration(provider: Provider) {
  const { error } = await supabase.from('integrations').delete().eq('provider', provider);
  if (error) throw new Error(error.message);
}

export type PushResult = { task_id: string; ok: boolean; url?: string; key?: string; skipped?: string; error?: string };

export async function pushTasks(taskIds: string[], provider: Provider): Promise<PushResult[]> {
  return (await callFn<{ results: PushResult[] }>('push-tasks', { task_ids: taskIds, provider })).results;
}

// ---------- Decks ----------

export type DeckKind = 'client_update' | 'site_report' | 'pitch' | 'proposal';
export const DECK_LABELS: Record<DeckKind, string> = {
  client_update: 'Client update',
  site_report: 'Site report',
  pitch: 'Pitch deck',
  proposal: 'Proposal',
};

export function makeDeck(opts: { kind: DeckKind; recordingId?: string; projectId?: string; audience?: string }) {
  return callFn<{ url: string; filename: string; slides: number }>('make-deck', {
    kind: opts.kind,
    recording_id: opts.recordingId,
    project_id: opts.projectId,
    audience: opts.audience || undefined,
  });
}

/** Download the generated .pptx and open the share sheet (or the browser download). */
export async function saveDeck(url: string, filename: string) {
  if (isWeb) {
    downloadWeb(filename, url);
    return;
  }
  const dest = new File(Paths.cache, filename);
  if (dest.exists) dest.delete();
  const file = await File.createDownloadTask(url, dest).downloadAsync();
  if (!file) throw new Error('Download was interrupted');
  await Sharing.shareAsync(file.uri, {
    mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    UTI: 'org.openxmlformats.presentationml.presentation',
  });
}
