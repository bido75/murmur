import AsyncStorage from "@react-native-async-storage/async-storage";
import * as DocumentPicker from "expo-document-picker";
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { isWeb } from "./dialog";
import { downloadWeb } from "./export";
import { uuid } from "./format";
import { APP_URL, SUPABASE_ANON_KEY, SUPABASE_URL } from "./config";
import { supabase } from "./supabase";
import {
  enqueue,
  keepFile,
  pendingOps,
  pendingPhotos,
  processRecording,
  type CreateOp,
} from "./sync";
import type {
  CalendarEvent,
  CalProvider,
  ConsentMethod,
  ConsentResponse,
  ConnKey,
  Integration,
  Invite,
  KeyPointDetail,
  MeetingBot,
  Member,
  Photo,
  Project,
  Provider,
  Recording,
  Role,
  ShareLink,
  Summary,
  SummaryTemplate,
  Task,
  Template,
  Transcript,
  Workspace,
} from "./types";
import {
  normalizeMediaLink,
  titleFromLink,
  type TranscriptionMode,
} from "./shared";

/** Register a new recording locally; it syncs to the server when there's a connection. */
export async function newRecording(opts: {
  template: Template;
  source: "mic" | "import" | "link";
  consentAt: string | null;
  consentMethod?: ConsentMethod;
  projectId?: string | null;
  calendarEventKey?: string | null;
  title?: string;
  customTemplateId?: string | null;
}) {
  const recordingId = uuid();
  await enqueue({
    kind: "create",
    recordingId,
    title: opts.title ?? "New recording",
    template: opts.template,
    source: opts.source,
    consentAt: opts.consentAt,
    consentMethod: opts.consentMethod,
    projectId: opts.projectId ?? null,
    calendarEventKey: opts.calendarEventKey ?? null,
    customTemplateId: opts.customTemplateId ?? null,
    createdAt: new Date().toISOString(),
  });
  return recordingId;
}

/** Import audio or video from a link (Dropbox, Google Drive, OneDrive or a direct file link). */
export async function importFromLink(
  link: string,
  template: Template,
  projectId: string | null = null,
  customTemplateId: string | null = null,
): Promise<string> {
  const check = normalizeMediaLink(link);
  if (!check.ok) throw new Error(check.reason);
  const recordingId = await newRecording({
    template,
    source: "link",
    consentAt: null,
    title: titleFromLink(check.url),
    projectId,
    customTemplateId,
  });
  await enqueue({ kind: "link", recordingId, url: check.url });
  await enqueue({ kind: "finalize", recordingId, durationMs: 0 });
  return recordingId;
}

/** Pick an audio or video file and send it through the same pipeline as a recording. */
export async function importAudio(
  template: Template,
  projectId: string | null = null,
): Promise<string | null> {
  const res = await DocumentPicker.getDocumentAsync({
    type: ["audio/*", "video/*"],
    copyToCacheDirectory: true,
  });
  if (res.canceled || !res.assets?.length) return null;
  const asset = res.assets[0];
  const ext = (asset.name.split(".").pop() || "m4a").toLowerCase();
  const title =
    asset.name.replace(/\.[^.]+$/, "").slice(0, 80) || "Imported audio";
  const recordingId = await newRecording({
    template,
    source: "import",
    consentAt: null,
    title,
    projectId,
  });
  const localUri = keepFile(asset.uri, recordingId, 1, ext);
  await enqueue({
    kind: "segment",
    recordingId,
    idx: 1,
    localUri,
    ext,
    durationMs: 0,
  });
  await enqueue({ kind: "finalize", recordingId, durationMs: 0 });
  return recordingId;
}

/** Recordings made offline that haven't reached the server yet. */
export async function localOnlyRecordings(): Promise<Recording[]> {
  const ops = await pendingOps();
  return ops
    .filter((o): o is CreateOp => o.kind === "create")
    .map((o) => ({
      id: o.recordingId,
      title: o.title,
      template: o.template,
      source: o.source,
      status: "uploading" as const,
      duration_ms: 0,
      error: o.lastError ?? null,
      created_at: o.createdAt,
    }));
}

export async function listRecordings(): Promise<Recording[]> {
  const { data, error } = await supabase
    .from("recordings")
    .select(
      "id, title, template, source, status, duration_ms, error, created_at, project_id",
    )
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw new Error(error.message);
  return (data ?? []) as Recording[];
}

export async function getRecording(id: string) {
  const [rec, tr, sum, tasks, segs, photos] = await Promise.all([
    supabase.from("recordings").select("*").eq("id", id).maybeSingle(),
    supabase
      .from("transcripts")
      .select("utterances, speaker_names")
      .eq("recording_id", id)
      .maybeSingle(),
    supabase
      .from("summaries")
      .select(
        "overview, key_points, key_point_details, decisions, open_questions, task_updates, site_log, site_log_external",
      )
      .eq("recording_id", id)
      .maybeSingle(),
    supabase
      .from("tasks")
      .select("*")
      .eq("recording_id", id)
      .neq("status", "dismissed")
      .order("created_at"),
    supabase
      .from("recording_segments")
      .select("idx, storage_path, source_url, duration_ms")
      .eq("recording_id", id)
      .order("idx"),
    listPhotos(id),
  ]);
  return {
    photos,
    recording: (rec.data ?? null) as Recording | null,
    transcript: (tr.data ?? null) as Transcript | null,
    summary: (sum.data ?? null) as Summary | null,
    tasks: (tasks.data ?? []) as Task[],
    segments: (segs.data ?? []) as {
      idx: number;
      storage_path: string | null;
      source_url: string | null;
      duration_ms: number;
    }[],
  };
}

/** A recording's photos: uploaded ones (signed URLs) plus any still waiting on this device. */
export async function listPhotos(recordingId: string): Promise<Photo[]> {
  const [{ data }, waiting] = await Promise.all([
    supabase
      .from("recording_photos")
      .select(
        "id, recording_id, storage_path, taken_ms, caption, width, height, created_at",
      )
      .eq("recording_id", recordingId),
    pendingPhotos(recordingId),
  ]);
  const rows = (data ?? []) as Photo[];
  if (rows.length) {
    const { data: signed } = await supabase.storage
      .from("photos")
      .createSignedUrls(
        rows.map((r) => r.storage_path),
        60 * 60,
      );
    const byPath = new Map((signed ?? []).map((x) => [x.path, x.signedUrl]));
    rows.forEach((r) => (r.url = byPath.get(r.storage_path) ?? null));
  }
  const have = new Set(rows.map((r) => r.id));
  const local: Photo[] = waiting
    .filter((w) => !have.has(w.photoId))
    .map((w) => ({
      id: w.photoId,
      recording_id: recordingId,
      storage_path: "",
      taken_ms: w.takenMs,
      caption: null,
      width: w.width,
      height: w.height,
      created_at: new Date().toISOString(),
      url: w.localUri,
      pending: true,
    }));
  return [...rows, ...local].sort(
    (a, b) =>
      (a.taken_ms ?? Number.MAX_SAFE_INTEGER) -
        (b.taken_ms ?? Number.MAX_SAFE_INTEGER) ||
      a.created_at.localeCompare(b.created_at),
  );
}

export async function setPhotoCaption(id: string, caption: string | null) {
  const { error } = await supabase
    .from("recording_photos")
    .update({ caption: caption?.trim() || null })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

export async function deletePhoto(photo: Photo) {
  if (photo.storage_path)
    await supabase.storage.from("photos").remove([photo.storage_path]);
  const { error } = await supabase
    .from("recording_photos")
    .delete()
    .eq("id", photo.id);
  if (error) throw new Error(error.message);
}

// ---------- Search ----------

export type SearchHit = {
  recording_id: string;
  title: string;
  created_at: string;
  project_id: string | null;
  template: Template;
  snippet: string | null;
  matched: "transcript" | "title" | "notes";
  at_ms: number | null;
};

export async function searchRecordings(q: string): Promise<SearchHit[]> {
  if (q.trim().length < 2) return [];
  const { data, error } = await supabase.rpc("search_recordings", {
    q: q.trim(),
    max_results: 30,
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as SearchHit[];
}

export async function searchTasks(
  q: string,
): Promise<(Task & { recordings: { title: string } | null })[]> {
  const term = q
    .trim()
    .replace(/[%_\\,()]/g, " ")
    .trim();
  if (term.length < 2) return [];
  const { data, error } = await supabase
    .from("tasks")
    .select("*, recordings!tasks_recording_id_fkey(title)")
    .ilike("text", `%${term}%`)
    .neq("status", "dismissed")
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) throw new Error(error.message);
  return (data ?? []) as (Task & { recordings: { title: string } | null })[];
}

// ---------- Sharing ----------

export async function listShareLinks(
  recordingId: string,
): Promise<ShareLink[]> {
  const { data, error } = await supabase
    .from("share_links")
    .select(
      "id, token, include_transcript, created_at, expires_at, revoked_at, views, allow_audio, allow_questions, has_password, clip_start_ms, clip_end_ms, title",
    )
    .eq("recording_id", recordingId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as ShareLink[];
}

export type ShareOptions = {
  include_transcript?: boolean;
  valid_days?: number | null;
  allow_audio?: boolean;
  allow_questions?: boolean;
  password?: string;
  clip_start_ms?: number;
  clip_end_ms?: number;
  title?: string;
};

export async function createShareLink(recordingId: string, opts: ShareOptions) {
  return rpc<string>("create_share_link_v2", { rec: recordingId, opts });
}

export async function revokeShareLink(id: string) {
  const { error } = await supabase
    .from("share_links")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

export function shareUrl(token: string, appUrl: string): string {
  return `${appUrl}/s/${token}`;
}

export async function emailAvailable(): Promise<boolean> {
  const { data, error } = await supabase.functions.invoke(
    "share/email-available",
    { method: "GET" },
  );
  return !error && Boolean(data?.available);
}

export function sendRecap(recordingId: string, to: string, note: string) {
  return callFn<{ sent: number; link: string | null }>("share/recap", {
    recording_id: recordingId,
    to,
    note: note.trim() || null,
  });
}

export function exportDocx(recordingId: string, includeTranscript: boolean) {
  return callFn<{ url: string; filename: string }>("share/docx", {
    recording_id: recordingId,
    include_transcript: includeTranscript,
  });
}

/** Public pages (no sign-in): shared notes and consent links. */
export class PublicError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}
export async function publicCall<T>(
  path: string,
  init: { method?: "GET" | "POST"; body?: unknown; password?: string } = {},
): Promise<T> {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/${path}`, {
    method: init.method ?? "GET",
    headers: {
      apikey: SUPABASE_ANON_KEY,
      "Content-Type": "application/json",
      ...(init.password ? { "x-share-password": init.password } : {}),
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok)
    throw new PublicError(
      data?.error ?? `Request failed (${res.status})`,
      res.status,
    );
  return data as T;
}

// ---------- Consent links ----------

export const createConsentRequest = (
  title: string,
  recordingId: string | null = null,
) =>
  rpc<string>("create_consent_request", { req_title: title, rec: recordingId });

export async function attachConsentRequest(token: string, recordingId: string) {
  const { error } = await supabase
    .from("consent_requests")
    .update({ recording_id: recordingId })
    .eq("token", token);
  if (error) throw new Error(error.message);
}

export async function consentResponses(
  recordingId: string,
): Promise<ConsentResponse[]> {
  const { data: reqs } = await supabase
    .from("consent_requests")
    .select("id")
    .eq("recording_id", recordingId);
  const ids = (reqs ?? []).map((r) => r.id);
  if (!ids.length) return [];
  const { data, error } = await supabase
    .from("consent_responses")
    .select("id, name, email, decision, created_at")
    .in("request_id", ids)
    .order("created_at");
  if (error) return [];
  return (data ?? []) as ConsentResponse[];
}

// ---------- Templates ----------

export async function listTemplates(): Promise<SummaryTemplate[]> {
  const { data, error } = await supabase
    .from("summary_templates")
    .select("id, name, instructions, base, workspace_id, user_id")
    .order("name");
  if (error) throw new Error(error.message);
  return (data ?? []) as SummaryTemplate[];
}

export async function saveTemplate(t: {
  id?: string;
  name: string;
  instructions: string;
  base: Template;
  workspace_id: string | null;
}) {
  const row = {
    name: t.name.trim(),
    instructions: t.instructions.trim(),
    base: t.base,
    workspace_id: t.workspace_id,
  };
  const { error } = t.id
    ? await supabase.from("summary_templates").update(row).eq("id", t.id)
    : await supabase.from("summary_templates").insert(row);
  if (error) throw new Error(error.message);
}

export async function deleteTemplate(id: string) {
  const { error } = await supabase
    .from("summary_templates")
    .delete()
    .eq("id", id);
  if (error) throw new Error(error.message);
}

// ---------- Privacy ----------

export type Retention = {
  audio_retention_days: number | null;
  recording_retention_days: number | null;
};

export async function getRetention(): Promise<Retention> {
  const { data } = await supabase
    .from("user_settings")
    .select("audio_retention_days, recording_retention_days")
    .maybeSingle();
  return (
    (data as Retention | null) ?? {
      audio_retention_days: null,
      recording_retention_days: null,
    }
  );
}

export async function saveRetention(r: Retention) {
  const me = await currentUserId();
  const { error } = await supabase
    .from("user_settings")
    .upsert({ user_id: me, ...r }, { onConflict: "user_id" });
  if (error) throw new Error(error.message);
}

export type Transcription = { language: string | null; redact: string[] };

export async function getTranscriptionSettings(): Promise<Transcription> {
  const { data } = await supabase
    .from("user_settings")
    .select("language, redact")
    .maybeSingle();
  return {
    language: (data?.language as string | null) ?? null,
    redact: (data?.redact as string[] | null) ?? [],
  };
}

export async function saveTranscriptionSettings(t: Transcription) {
  const me = await currentUserId();
  const { error } = await supabase
    .from("user_settings")
    .upsert(
      { user_id: me, language: t.language, redact: t.redact },
      { onConflict: "user_id" },
    );
  if (error) throw new Error(error.message);
}

export type Translation = {
  lang: string;
  summary: {
    overview: string;
    key_points: string[];
    decisions: string[];
    open_questions: string[];
  } | null;
  tasks: Record<string, string> | null;
  utterances: string[] | null;
};

export async function translateRecording(
  recordingId: string,
  lang: string,
  includeTranscript: boolean,
): Promise<Translation> {
  const r = await callFn<Omit<Translation, "lang">>("translate", {
    recording_id: recordingId,
    lang,
    include_transcript: includeTranscript,
  });
  return { lang, ...r };
}

export async function deleteAccount() {
  await callFn<{ deleted: boolean }>("account/delete", { confirm: "DELETE" });
  await AsyncStorage.clear().catch(() => {});
  await supabase.auth.signOut().catch(() => {});
}

// ---------- Meeting bot ----------

export async function botAvailable(): Promise<boolean> {
  const { data, error } = await supabase.functions.invoke("bot/available", {
    method: "GET",
  });
  return !error && Boolean(data?.available);
}

export function scheduleBot(o: {
  meetingUrl: string;
  joinAt: string | null;
  title?: string;
  projectId?: string | null;
  eventKey?: string | null;
}) {
  return callFn<{ recording_id: string }>("bot/schedule", {
    meeting_url: o.meetingUrl,
    join_at: o.joinAt,
    title: o.title,
    project_id: o.projectId ?? null,
    event_key: o.eventKey ?? null,
  });
}

export function cancelBot(recordingId: string) {
  return callFn<{ ok: boolean }>("bot/cancel", { recording_id: recordingId });
}

export async function getBot(recordingId: string): Promise<MeetingBot | null> {
  const { data } = await supabase
    .from("meeting_bots")
    .select("status, status_detail, meeting_url, join_at")
    .eq("recording_id", recordingId)
    .maybeSingle();
  return (data as MeetingBot | null) ?? null;
}

// ---------- Editing ----------

export async function setSpeakerName(
  recordingId: string,
  speaker: number,
  name: string,
  current: Record<string, string>,
) {
  const next = { ...current };
  if (name.trim()) next[String(speaker)] = name.trim().slice(0, 60);
  else delete next[String(speaker)];
  const { error } = await supabase
    .from("transcripts")
    .update({ speaker_names: next })
    .eq("recording_id", recordingId);
  if (error) throw new Error(error.message);
  return next;
}

export async function updateUtteranceText(
  recordingId: string,
  utterances: {
    start_ms: number;
    end_ms: number;
    speaker: number;
    text: string;
  }[],
  index: number,
  text: string,
) {
  const next = utterances.map((u, i) =>
    i === index ? { ...u, text: text.trim() } : u,
  );
  const { error } = await supabase
    .from("transcripts")
    .update({ utterances: next, edited_at: new Date().toISOString() })
    .eq("recording_id", recordingId);
  if (error) throw new Error(error.message);
  return next;
}

export async function updateSummary(
  recordingId: string,
  patch: Partial<
    Pick<Summary, "overview" | "key_points" | "open_questions" | "decisions">
  >,
) {
  const body: Record<string, unknown> = {
    ...patch,
    edited_at: new Date().toISOString(),
  };
  if (patch.key_points) {
    // A key point that was edited no longer matches the quote it came from, so its time
    // chip goes away. The points that were left alone keep theirs.
    const { data, error } = await supabase
      .from("summaries")
      .select("key_point_details")
      .eq("recording_id", recordingId)
      .maybeSingle();
    // If the details could not be read, leave them alone: writing an empty list would
    // take the time chip off every point, including the ones that were not edited.
    if (!error) {
      const details = (
        (data?.key_point_details ?? []) as KeyPointDetail[]
      ).filter((d) => patch.key_points!.includes(d.text));
      body.key_point_details = details;
    }
  }
  const { error } = await supabase
    .from("summaries")
    .update(body)
    .eq("recording_id", recordingId);
  if (error) throw new Error(error.message);
}

export async function saveUserNotes(recordingId: string, notes: string) {
  const { error } = await supabase
    .from("recordings")
    .update({ user_notes: notes.trim() || null })
    .eq("id", recordingId);
  if (error) throw new Error(error.message);
}

// ---------- Comments and bookmarks ----------

export type Comment = {
  id: string;
  user_id: string;
  author_email: string | null;
  kind: "comment" | "bookmark";
  at_ms: number | null;
  body: string;
  created_at: string;
};

export async function listComments(recordingId: string): Promise<Comment[]> {
  const { data, error } = await supabase
    .from("recording_comments")
    .select("id, user_id, author_email, kind, at_ms, body, created_at")
    .eq("recording_id", recordingId)
    .order("created_at");
  if (error) return [];
  return (data ?? []) as Comment[];
}

export async function addComment(
  recordingId: string,
  c: { kind: "comment" | "bookmark"; at_ms: number | null; body: string },
) {
  const { data } = await supabase.auth.getSession();
  const { error } = await supabase
    .from("recording_comments")
    .insert({
      recording_id: recordingId,
      ...c,
      author_email: data.session?.user.email ?? null,
    });
  if (error) throw new Error(error.message);
}

export async function deleteComment(id: string) {
  const { error } = await supabase
    .from("recording_comments")
    .delete()
    .eq("id", id);
  if (error) throw new Error(error.message);
}

// ---------- Follow-up email ----------

export function draftFollowup(
  recordingId: string,
  tone: "friendly" | "formal",
) {
  return callFn<{ subject: string; body: string }>("share/followup", {
    recording_id: recordingId,
    tone,
  });
}

export async function retryProcessing(id: string) {
  await processRecording(id);
}

export async function renameRecording(id: string, title: string) {
  const { error } = await supabase
    .from("recordings")
    .update({ title })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

export async function deleteRecording(id: string) {
  const [{ data: segs }, { data: photos }] = await Promise.all([
    supabase
      .from("recording_segments")
      .select("storage_path")
      .eq("recording_id", id),
    supabase
      .from("recording_photos")
      .select("storage_path")
      .eq("recording_id", id),
  ]);
  const paths = (segs ?? [])
    .map((s) => s.storage_path)
    .filter((p): p is string => !!p);
  if (paths.length) await supabase.storage.from("audio").remove(paths);
  const photoPaths = (photos ?? []).map((p) => p.storage_path);
  if (photoPaths.length)
    await supabase.storage.from("photos").remove(photoPaths);
  const { error } = await supabase.from("recordings").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

export async function audioUrl(storagePath: string): Promise<string | null> {
  const { data } = await supabase.storage
    .from("audio")
    .createSignedUrl(storagePath, 60 * 60);
  return data?.signedUrl ?? null;
}

export async function listTasks(
  filter: "open" | "review" | "done",
): Promise<(Task & { recordings: { title: string } | null })[]> {
  let q = supabase
    .from("tasks")
    .select("*, recordings!tasks_recording_id_fkey(title)")
    .order("created_at", { ascending: false })
    .limit(300);
  if (filter === "open") q = q.eq("status", "open").eq("needs_review", false);
  if (filter === "review") q = q.eq("status", "open").eq("needs_review", true);
  if (filter === "done") q = q.eq("status", "done");
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as (Task & { recordings: { title: string } | null })[];
}

export async function updateTask(
  id: string,
  patch: Partial<
    Pick<
      Task,
      | "status"
      | "needs_review"
      | "owner"
      | "due_text"
      | "text"
      | "kind"
      | "completed_by_recording_id"
      | "completion_quote"
    >
  >,
) {
  const { error } = await supabase.from("tasks").update(patch).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function ask(
  question: string,
  recordingId?: string,
): Promise<{
  answer: string;
  sources: { recording_id: string; title: string }[];
}> {
  const { data, error } = await supabase.functions.invoke("ask", {
    body: { question, recording_id: recordingId },
  });
  if (error) throw new Error(error.message);
  return data;
}

// Local settings
/** myState: a US state code, 'OTHER' for outside the US, or null when not set. */
export type Settings = {
  consentReminder: boolean;
  defaultTemplate: Template;
  fieldMode: boolean;
  myState: string | null;
  /** Transcribe on this phone. Kept so settings saved before the mode picker still work. */
  onDevice: boolean;
  /** Which speech-to-text engine to use. */
  transcriptionMode: TranscriptionMode;
  /** Never upload audio, whatever else is chosen. */
  localOnly: boolean;
  /** Prefer the device when both the device and the cloud would work. */
  preferLocal: boolean;
};
const SETTINGS_KEY = "settings.v1";
const DEFAULT_SETTINGS: Settings = {
  consentReminder: true,
  defaultTemplate: "meeting",
  fieldMode: false,
  myState: null,
  onDevice: false,
  transcriptionMode: "auto",
  localOnly: false,
  preferLocal: false,
};

export async function getSettings(): Promise<Settings> {
  try {
    const raw = await AsyncStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const saved = JSON.parse(raw) as Partial<Settings>;
    // Settings saved before the mode picker only had "onDevice"; carry that over
    // so a user who chose on-device transcription keeps it.
    const transcriptionMode =
      saved.transcriptionMode ??
      (saved.onDevice ? "local" : DEFAULT_SETTINGS.transcriptionMode);
    return {
      ...DEFAULT_SETTINGS,
      ...saved,
      transcriptionMode,
      onDevice: saved.onDevice ?? transcriptionMode === "local",
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export async function saveSettings(s: Settings) {
  await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
}

// ---------- Projects ----------

/** Embedded many-to-one rows arrive as an object at runtime; untyped clients type them as arrays. */
function one<T>(v: T | T[] | null | undefined): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : (v ?? null);
}
type ProjectRow = Omit<Project, "workspaces"> & {
  workspaces: { name: string } | { name: string }[] | null;
};
const toProject = (r: ProjectRow): Project => ({
  ...r,
  workspaces: one(r.workspaces),
});

export async function listProjects(
  includeArchived = false,
): Promise<Project[]> {
  let q = supabase
    .from("projects")
    .select("id, name, archived, created_at, workspace_id, workspaces(name)")
    .order("created_at", { ascending: false });
  if (!includeArchived) q = q.eq("archived", false);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return ((data ?? []) as ProjectRow[]).map(toProject);
}

export async function createProject(
  name: string,
  workspaceId: string | null = null,
): Promise<Project> {
  const { data, error } = await supabase
    .from("projects")
    .insert({ name: name.trim(), workspace_id: workspaceId })
    .select("id, name, archived, created_at, workspace_id, workspaces(name)")
    .single();
  if (error) throw new Error(error.message);
  return toProject(data as ProjectRow);
}

export async function updateProject(
  id: string,
  patch: Partial<Pick<Project, "name" | "archived">>,
) {
  const { error } = await supabase.from("projects").update(patch).eq("id", id);
  if (error) throw new Error(error.message);
}

/** Words to listen for: split on commas or new lines, trimmed, deduplicated, at most 100. */
export function parseVocabulary(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.split(/[,\n]/)) {
    const w = raw.replace(/\s+/g, " ").trim().slice(0, 60);
    if (!w || seen.has(w.toLowerCase())) continue;
    seen.add(w.toLowerCase());
    out.push(w);
  }
  return out.slice(0, 100);
}

export async function setProjectVocabulary(id: string, words: string[]) {
  const { error } = await supabase
    .from("projects")
    .update({ vocabulary: words })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

export async function setRecordingProject(
  recordingId: string,
  projectId: string | null,
) {
  const { error } = await supabase
    .from("recordings")
    .update({ project_id: projectId })
    .eq("id", recordingId);
  if (error) throw new Error(error.message);
}

type TaskWithSource = Task & {
  recordings: { title: string; project_id: string | null } | null;
};

/** Open, confirmed tasks across a project's recordings: the brief shown before the next meeting. */
export async function openProjectTasks(
  projectId: string,
): Promise<TaskWithSource[]> {
  const { data, error } = await supabase
    .from("tasks")
    .select("*, recordings!tasks_recording_id_fkey!inner(title, project_id)")
    .eq("recordings.project_id", projectId)
    .eq("status", "open")
    .eq("needs_review", false)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw new Error(error.message);
  return (data ?? []) as TaskWithSource[];
}

export async function getProject(id: string) {
  const [proj, recs, tasks] = await Promise.all([
    supabase
      .from("projects")
      .select(
        "id, name, archived, created_at, workspace_id, vocabulary, workspaces(name)",
      )
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("recordings")
      .select(
        "id, title, template, source, status, duration_ms, error, created_at, project_id",
      )
      .eq("project_id", id)
      .order("created_at", { ascending: false }),
    openProjectTasks(id),
  ]);
  return {
    project: proj.data ? toProject(proj.data as ProjectRow) : null,
    recordings: (recs.data ?? []) as Recording[],
    openTasks: tasks,
  };
}

// ---------- Task trackers ----------

export async function listIntegrations(): Promise<Integration[]> {
  const { data, error } = await supabase
    .from("integrations")
    .select("provider, config");
  if (error) throw new Error(error.message);
  return (data ?? []) as Integration[];
}

async function callFn<T>(
  name: string,
  body: Record<string, unknown>,
): Promise<T> {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) {
    // Surface the function's own error message when there is one.
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === "function") {
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

export function connectIntegration(
  provider: ConnKey,
  token: string,
  extra: { email?: string; site?: string; key?: string } = {},
) {
  return callFn<Integration>("integrations", {
    action: "connect",
    provider,
    token,
    ...extra,
  });
}

export async function integrationTargets(provider: ConnKey) {
  return (
    await callFn<{ targets: { id: string; name: string }[] }>("integrations", {
      action: "targets",
      provider,
    })
  ).targets;
}

export function setIntegrationTarget(
  provider: ConnKey,
  target: { id: string; name: string },
) {
  return callFn<Integration>("integrations", {
    action: "set_target",
    provider,
    target,
  });
}

export async function disconnectIntegration(provider: ConnKey) {
  const { error } = await supabase
    .from("integrations")
    .delete()
    .eq("provider", provider);
  if (error) throw new Error(error.message);
}

export type PushResult = {
  task_id: string;
  ok: boolean;
  url?: string;
  key?: string;
  skipped?: string;
  error?: string;
};

export async function pushTasks(
  taskIds: string[],
  provider: Provider,
): Promise<PushResult[]> {
  return (
    await callFn<{ results: PushResult[] }>("push-tasks", {
      task_ids: taskIds,
      provider,
    })
  ).results;
}

// ---------- Procore ----------

export async function procoreAvailable(): Promise<boolean> {
  const { data, error } = await supabase.functions.invoke("procore/available", {
    method: "GET",
  });
  return !error && Boolean(data?.available);
}

/** Returns Procore's sign-in URL to open in the browser. */
export async function startProcoreConnect(returnTo: string): Promise<string> {
  return (
    await callFn<{ url: string }>("procore/start", { return_to: returnTo })
  ).url;
}

/** Add the recording's site log to the chosen Procore project's daily log, dated the day it was recorded. */
export async function sendSiteLogToProcore(
  recordingId: string,
  recordedAt: string,
): Promise<{ url: string; already?: boolean }> {
  const d = new Date(recordedAt);
  const local = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return callFn<{ url: string; already?: boolean }>("procore/daily-log", {
    recording_id: recordingId,
    date: local,
  });
}

// ---------- Decks ----------

export type DeckKind = "client_update" | "site_report" | "pitch" | "proposal";
export const DECK_LABELS: Record<DeckKind, string> = {
  client_update: "Client update",
  site_report: "Site report",
  pitch: "Pitch deck",
  proposal: "Proposal",
};

export function makeDeck(opts: {
  kind: DeckKind;
  recordingId?: string;
  projectId?: string;
  audience?: string;
}) {
  return callFn<{ url: string; filename: string; slides: number }>(
    "make-deck",
    {
      kind: opts.kind,
      recording_id: opts.recordingId,
      project_id: opts.projectId,
      audience: opts.audience || undefined,
    },
  );
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
  if (!file) throw new Error("Download was interrupted");
  const word = filename.toLowerCase().endsWith(".docx");
  await Sharing.shareAsync(file.uri, {
    mimeType: word
      ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      : "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    UTI: word
      ? "org.openxmlformats.wordprocessingml.document"
      : "org.openxmlformats.presentationml.presentation",
  });
}

// ---------- Teams ----------

let cachedUserId: string | null = null;
export async function currentUserId(): Promise<string | null> {
  if (cachedUserId) return cachedUserId;
  const { data } = await supabase.auth.getSession();
  cachedUserId = data.session?.user.id ?? null;
  return cachedUserId;
}
supabase.auth.onAuthStateChange((_e, session) => {
  cachedUserId = session?.user.id ?? null;
});

export async function listWorkspaces(): Promise<Workspace[]> {
  const me = await currentUserId();
  if (!me) return [];
  const { data, error } = await supabase
    .from("workspace_members")
    .select("role, workspaces(id, name)")
    .eq("user_id", me);
  if (error) throw new Error(error.message);
  return (data ?? [])
    .map((r) => {
      const w = (
        Array.isArray(r.workspaces) ? r.workspaces[0] : r.workspaces
      ) as { id: string; name: string } | null;
      return w ? { id: w.id, name: w.name, role: r.role as Role } : null;
    })
    .filter((w): w is Workspace => !!w);
}

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}

export const createWorkspace = (name: string) =>
  rpc<string>("create_workspace", { ws_name: name.trim() });
export const inviteMember = (
  ws: string,
  email: string,
  role: "admin" | "member",
) =>
  rpc<string>("create_invite", {
    ws,
    invitee_email: email.trim(),
    invite_role: role,
  });
export const acceptInvite = (code: string) =>
  rpc<string>("accept_invite", { invite_code: code });
export const removeMember = (ws: string, member: string) =>
  rpc<void>("remove_member", { ws, member });
export const setMemberRole = (ws: string, member: string, role: Role) =>
  rpc<void>("set_member_role", { ws, member, new_role: role });

export async function revokeInvite(id: string) {
  const { error } = await supabase
    .from("workspace_invites")
    .delete()
    .eq("id", id);
  if (error) throw new Error(error.message);
}

export async function renameWorkspace(id: string, name: string) {
  const { error } = await supabase
    .from("workspaces")
    .update({ name: name.trim() })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

export async function getWorkspace(id: string) {
  const [ws, members, invites] = await Promise.all([
    supabase.from("workspaces").select("id, name").eq("id", id).maybeSingle(),
    supabase
      .from("workspace_members")
      .select("user_id, role, email, joined_at")
      .eq("workspace_id", id)
      .order("joined_at"),
    supabase
      .from("workspace_invites")
      .select("id, email, role, code, created_at, expires_at")
      .eq("workspace_id", id)
      .is("accepted_at", null)
      .order("created_at", { ascending: false }),
  ]);
  return {
    workspace: (ws.data ?? null) as { id: string; name: string } | null,
    members: (members.data ?? []) as Member[],
    invites: (invites.data ?? []) as Invite[],
  };
}

/** Format an invite code as XXXXX-XXXXX for reading aloud or typing. */
export function prettyCode(code: string): string {
  return code.length === 10 ? `${code.slice(0, 5)}-${code.slice(5)}` : code;
}

// ---------- API tokens (MCP) ----------

export type ApiToken = {
  id: string;
  name: string;
  prefix: string;
  created_at: string;
  last_used_at: string | null;
};

export async function listApiTokens(): Promise<ApiToken[]> {
  const { data, error } = await supabase
    .from("api_tokens")
    .select("id, name, prefix, created_at, last_used_at")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as ApiToken[];
}

export const createApiToken = (name: string) =>
  rpc<string>("create_api_token", { token_name: name });

export async function revokeApiToken(id: string) {
  const { error } = await supabase.from("api_tokens").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

// ---------- Connected AI apps (OAuth) ----------

export type ConnectedApp = {
  client_id: string;
  client_name: string;
  connected_at: string;
  last_used_at: string;
};
export const listConnectedApps = () =>
  rpc<ConnectedApp[]>("my_connected_apps", {});
export const disconnectApp = (clientId: string) =>
  rpc<void>("disconnect_app", { p_client_id: clientId });

// ---------- Calendar ----------

export async function calendarProviders(): Promise<CalProvider[]> {
  const { data, error } = await supabase.functions.invoke(
    "calendar/providers",
    { method: "GET" },
  );
  if (error) return [];
  return (data?.providers ?? []) as CalProvider[];
}

export async function listCalendarConnections(): Promise<
  { provider: CalProvider; account_email: string | null }[]
> {
  const { data, error } = await supabase
    .from("calendar_connections")
    .select("provider, account_email");
  if (error) throw new Error(error.message);
  return (data ?? []) as {
    provider: CalProvider;
    account_email: string | null;
  }[];
}

/** Returns the provider sign-in URL to open in the browser. */
export async function startCalendarConnect(
  provider: CalProvider,
  returnTo: string,
): Promise<string> {
  return (
    await callFn<{ url: string }>("calendar/start", {
      provider,
      return_to: returnTo,
    })
  ).url;
}

export async function disconnectCalendar(provider: CalProvider) {
  const { error } = await supabase
    .from("calendar_connections")
    .delete()
    .eq("provider", provider);
  if (error) throw new Error(error.message);
}

export async function upcomingEvents(days = 7) {
  return callFn<{
    connected: { provider: CalProvider; email: string | null }[];
    problems: string[];
    events: CalendarEvent[];
  }>("calendar/events", { days });
}

export async function linkEventToProject(
  eventKey: string,
  projectId: string | null,
) {
  const me = await currentUserId();
  if (!projectId) {
    const { error } = await supabase
      .from("calendar_links")
      .delete()
      .eq("event_key", eventKey);
    if (error) throw new Error(error.message);
    return;
  }
  const { error } = await supabase
    .from("calendar_links")
    .upsert(
      { user_id: me, event_key: eventKey, project_id: projectId },
      { onConflict: "user_id,event_key" },
    );
  if (error) throw new Error(error.message);
}

/** What to know before the next meeting in a project: open tasks and the last meeting's notes. */
export async function getBrief(projectId: string) {
  const [openTasks, { data: last }] = await Promise.all([
    openProjectTasks(projectId),
    supabase
      .from("recordings")
      .select(
        "id, title, created_at, summaries(overview, decisions, open_questions)",
      )
      .eq("project_id", projectId)
      .eq("status", "ready")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  const summary = last
    ? one(
        (last as { summaries: unknown }).summaries as
          Summary | Summary[] | null,
      )
    : null;
  return {
    openTasks,
    last: last
      ? {
          id: last.id as string,
          title: last.title as string,
          created_at: last.created_at as string,
          summary,
        }
      : null,
  };
}

// ---------- Sign-in connections (Slack, Salesforce, Google Docs, OneNote) ----------

export type OAuthConn = "slack" | "salesforce" | "google_docs" | "onenote";

export async function connectAvailable(): Promise<OAuthConn[]> {
  const { data, error } = await supabase.functions.invoke("connect/available", {
    method: "GET",
  });
  return error ? [] : ((data?.providers ?? []) as OAuthConn[]);
}

/** Returns the provider's sign-in URL; it sends the user back with ?connected=provider:status. */
export async function startConnect(
  provider: OAuthConn,
  returnTo: string,
): Promise<string> {
  return (
    await callFn<{ url: string }>("connect/start", {
      provider,
      return_to: returnTo,
    })
  ).url;
}

// ---------- Send notes to another tool ----------

export type Destination =
  "slack" | "notion" | "google_docs" | "onenote" | "hubspot" | "salesforce";
export const DESTINATIONS: Destination[] = [
  "slack",
  "notion",
  "google_docs",
  "onenote",
  "hubspot",
  "salesforce",
];
export type ExportResult = {
  url: string | null;
  channel?: string | null;
  linked?: number;
};

export function exportNotes(
  recordingId: string,
  destination: Destination,
  emails: string[] = [],
) {
  return callFn<ExportResult>("export", {
    recording_id: recordingId,
    destination,
    emails,
  });
}

export async function getExports(
  recordingId: string,
): Promise<Partial<Record<Destination, ExportResult & { at: string }>>> {
  const { data } = await supabase
    .from("summaries")
    .select("exports")
    .eq("recording_id", recordingId)
    .maybeSingle();
  return (
    (data?.exports as Partial<
      Record<Destination, ExportResult & { at: string }>
    > | null) ?? {}
  );
}

// ---------- Automations ----------

export type AutomationAction =
  | { type: "slack" }
  | { type: "email"; to: string[] }
  | { type: "tracker"; provider: string }
  | {
      type: "export";
      destination:
        "notion" | "google_docs" | "onenote" | "hubspot" | "salesforce";
    }
  | { type: "webhook"; url: string };

export type Automation = {
  id: string;
  name: string;
  project_id: string | null;
  template: string | null;
  actions: AutomationAction[];
  active: boolean;
  last_run_at: string | null;
  last_result: string | null;
};

export async function listAutomations(): Promise<Automation[]> {
  const { data, error } = await supabase
    .from("automations")
    .select(
      "id, name, project_id, template, actions, active, last_run_at, last_result",
    )
    .order("created_at");
  if (error) throw new Error(error.message);
  return (data ?? []) as Automation[];
}

export async function saveAutomation(
  a: Omit<Automation, "id" | "last_run_at" | "last_result"> & { id?: string },
) {
  const row = {
    name: a.name.trim(),
    project_id: a.project_id,
    template: a.template,
    actions: a.actions,
    active: a.active,
  };
  const q = a.id
    ? supabase.from("automations").update(row).eq("id", a.id)
    : supabase.from("automations").insert(row);
  const { error } = await q;
  if (error) throw new Error(error.message);
}

export async function deleteAutomation(id: string) {
  const { error } = await supabase.from("automations").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

// ---------- Webhooks ----------

export type WebhookEvent =
  "recording.ready" | "recording.failed" | "task.created";
export type Webhook = {
  id: string;
  url: string;
  secret: string;
  events: WebhookEvent[];
  project_id: string | null;
  active: boolean;
  last_status: number | null;
  last_error: string | null;
  last_delivery_at: string | null;
};

export async function listWebhooks(): Promise<Webhook[]> {
  const { data, error } = await supabase
    .from("webhooks")
    .select(
      "id, url, secret, events, project_id, active, last_status, last_error, last_delivery_at",
    )
    .order("created_at");
  if (error) throw new Error(error.message);
  return (data ?? []) as Webhook[];
}

export async function addWebhook(
  url: string,
  events: WebhookEvent[],
  projectId: string | null,
) {
  const { error } = await supabase
    .from("webhooks")
    .insert({ url: url.trim(), events, project_id: projectId });
  if (error)
    throw new Error(
      error.message.includes("check")
        ? "The address must start with https://"
        : error.message,
    );
}

export async function setWebhookActive(id: string, active: boolean) {
  const { error } = await supabase
    .from("webhooks")
    .update({ active })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

export async function deleteWebhook(id: string) {
  const { error } = await supabase.from("webhooks").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

export function apiBaseUrl() {
  return `${(process.env.EXPO_PUBLIC_SUPABASE_URL ?? "").replace(/\/$/, "")}/functions/v1/api/v1`;
}

// ---------- Topic alerts, weekly digest, automatic notetaker ----------

export type TopicAlert = {
  id: string;
  phrase: string;
  project_id: string | null;
  email: boolean;
};

export async function listTopicAlerts(): Promise<TopicAlert[]> {
  const { data, error } = await supabase
    .from("topic_alerts")
    .select("id, phrase, project_id, email")
    .order("created_at");
  if (error) throw new Error(error.message);
  return (data ?? []) as TopicAlert[];
}

export async function addTopicAlert(
  phrase: string,
  projectId: string | null,
  email: boolean,
) {
  const { error } = await supabase
    .from("topic_alerts")
    .insert({ phrase: phrase.trim(), project_id: projectId, email });
  if (error)
    throw new Error(
      error.message.includes("check")
        ? "Use 2 to 80 characters."
        : error.message,
    );
}

export async function deleteTopicAlert(id: string) {
  const { error } = await supabase.from("topic_alerts").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

export type Routines = {
  weekly_digest: boolean;
  auto_notetaker: boolean;
  timezone: string | null;
};

export async function getRoutines(): Promise<Routines> {
  const { data } = await supabase
    .from("user_settings")
    .select("weekly_digest, auto_notetaker, timezone")
    .maybeSingle();
  return {
    weekly_digest: Boolean(data?.weekly_digest),
    auto_notetaker: Boolean(data?.auto_notetaker),
    timezone: (data?.timezone as string | null) ?? null,
  };
}

export async function saveRoutines(r: Partial<Routines>) {
  const me = await currentUserId();
  const { error } = await supabase
    .from("user_settings")
    .upsert({ user_id: me, ...r }, { onConflict: "user_id" });
  if (error) throw new Error(error.message);
}

// ---------- Phone calls (Murmur number) and Aircall ----------

export async function phoneInfo(): Promise<{
  number: string | null;
  allowed: string[];
}> {
  const { data, error } = await supabase.functions.invoke("phone/info", {
    method: "GET",
  });
  return error || !data
    ? { number: null, allowed: ["+1"] }
    : (data as { number: string | null; allowed: string[] });
}

export async function getPhoneLink(): Promise<{
  phone_e164: string;
  locked_until: string | null;
} | null> {
  const { data } = await supabase
    .from("phone_links")
    .select("phone_e164, locked_until")
    .maybeSingle();
  return (
    (data as { phone_e164: string; locked_until: string | null } | null) ?? null
  );
}

export async function setPhoneLink(phone: string, pin: string) {
  const { error } = await supabase.rpc("set_phone_link", { phone, pin });
  if (error) throw new Error(error.message);
}

export async function removePhoneLink() {
  const { error } = await supabase
    .from("phone_links")
    .delete()
    .not("user_id", "is", null);
  if (error) throw new Error(error.message);
}

export async function aircallSetup(): Promise<string> {
  return (await callFn<{ webhook_url: string }>("aircall/setup", {}))
    .webhook_url;
}

export function aircallConnect(opts: {
  api_id: string;
  api_token: string;
  webhook_token: string;
  only_mine: boolean;
}) {
  return callFn<{ ok: true; account: string }>("aircall/connect", opts);
}

// ---------- Linked devices (browser extension, watches) ----------

export type Device = {
  id: string;
  name: string;
  kind: "extension" | "watch" | "wear" | "desktop" | "other";
  prefix: string;
  created_at: string;
  last_used_at: string | null;
};

export async function createDeviceCode(): Promise<string> {
  const { data, error } = await supabase.rpc("create_device_link");
  if (error) throw new Error(error.message);
  return data as string;
}

export async function listDevices(): Promise<Device[]> {
  const { data, error } = await supabase
    .from("device_tokens")
    .select("id, name, kind, prefix, created_at, last_used_at")
    .order("created_at");
  if (error) throw new Error(error.message);
  return (data ?? []) as Device[];
}

export async function unlinkDevice(id: string) {
  const { error } = await supabase.from("device_tokens").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

/** Hand a transcript made on this phone to the server (no audio is uploaded). */
export function sendLocalTranscript(
  recordingId: string,
  utterances: {
    start_ms: number;
    end_ms: number;
    speaker: number;
    text: string;
  }[],
  durationMs: number,
) {
  return callFn<{ ok: true }>("ingest/local-transcript", {
    recording_id: recordingId,
    utterances,
    duration_ms: durationMs,
  });
}

// ---------- Company controls (team admins) ----------

export type Policy = {
  workspace_id: string;
  redact: string[];
  audio_retention_days: number | null;
  recording_retention_days: number | null;
  allow_public_links: boolean;
  max_link_days: number | null;
  require_consent: boolean;
  updated_at?: string;
};

export async function getPolicy(ws: string): Promise<Policy | null> {
  const { data } = await supabase
    .from("workspace_policies")
    .select(
      "workspace_id, redact, audio_retention_days, recording_retention_days, allow_public_links, max_link_days, require_consent, updated_at",
    )
    .eq("workspace_id", ws)
    .maybeSingle();
  return (data as Policy | null) ?? null;
}

export async function savePolicy(p: Policy) {
  const { updated_at: _skip, ...row } = p;
  const { error } = await supabase
    .from("workspace_policies")
    .upsert(row, { onConflict: "workspace_id" });
  if (error) throw new Error(error.message);
}

/** The team policy for a project (members can read it), e.g. to require consent before recording. */
export async function policyForProject(
  projectId: string | null,
): Promise<Policy | null> {
  if (!projectId) return null;
  const { data: p } = await supabase
    .from("projects")
    .select("workspace_id")
    .eq("id", projectId)
    .maybeSingle();
  return p?.workspace_id ? getPolicy(p.workspace_id as string) : null;
}

export type UsageRow = {
  user_id: string;
  email: string | null;
  role: string;
  recordings: number;
  minutes: number;
  last_recording_at: string | null;
};

export async function workspaceUsage(
  ws: string,
  days = 30,
): Promise<UsageRow[]> {
  const { data, error } = await supabase.rpc("workspace_usage", { ws, days });
  if (error) throw new Error(error.message);
  return ((data ?? []) as UsageRow[]).map((r) => ({
    ...r,
    recordings: Number(r.recordings),
    minutes: Number(r.minutes),
  }));
}

export type AuditEvent = {
  id: number;
  actor_email: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  meta: Record<string, unknown>;
  created_at: string;
};

export async function auditEvents(
  ws: string | null,
  before?: number,
): Promise<AuditEvent[]> {
  let q = supabase
    .from("audit_events")
    .select("id, actor_email, action, target_type, target_id, meta, created_at")
    .order("id", { ascending: false })
    .limit(100);
  q = ws ? q.eq("workspace_id", ws) : q.is("workspace_id", null);
  if (before) q = q.lt("id", before);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as AuditEvent[];
}

export type Domain = {
  domain: string;
  verify_token: string;
  verified_at: string | null;
  auto_join: boolean;
  sso_provider_id: string | null;
  sso_required: boolean;
};

export async function listDomains(ws: string): Promise<Domain[]> {
  const { data, error } = await supabase
    .from("workspace_domains")
    .select(
      "domain, verify_token, verified_at, auto_join, sso_provider_id, sso_required",
    )
    .eq("workspace_id", ws)
    .order("created_at");
  if (error) throw new Error(error.message);
  return (data ?? []) as Domain[];
}

export async function addDomain(ws: string, domain: string) {
  const { error } = await supabase
    .from("workspace_domains")
    .insert({ workspace_id: ws, domain: domain.trim().toLowerCase() });
  if (error)
    throw new Error(
      error.message.includes("duplicate")
        ? "That domain is already claimed."
        : error.message.includes("check")
          ? "Enter a domain like acme.com"
          : error.message,
    );
}

export async function removeDomain(domain: string) {
  const { error } = await supabase
    .from("workspace_domains")
    .delete()
    .eq("domain", domain);
  if (error) throw new Error(error.message);
}

export async function setDomainAutoJoin(domain: string, auto_join: boolean) {
  const { error } = await supabase
    .from("workspace_domains")
    .update({ auto_join })
    .eq("domain", domain);
  if (error) throw new Error(error.message);
}

export function verifyDomain(domain: string) {
  return callFn<{ verified: boolean; expected?: string }>(
    "admin/verify-domain",
    { domain },
  );
}

export async function createScimToken(ws: string): Promise<string> {
  const { data, error } = await supabase.rpc("create_scim_token", { ws });
  if (error) throw new Error(error.message);
  return data as string;
}

export async function listScimTokens(
  ws: string,
): Promise<
  {
    id: string;
    prefix: string;
    created_at: string;
    last_used_at: string | null;
  }[]
> {
  const { data, error } = await supabase
    .from("scim_tokens")
    .select("id, prefix, created_at, last_used_at")
    .eq("workspace_id", ws)
    .order("created_at");
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function revokeScimToken(id: string) {
  const { error } = await supabase.from("scim_tokens").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

export function scimBaseUrl() {
  return `${SUPABASE_URL.replace(/\/$/, "")}/functions/v1/scim/v2`;
}

export function exportMyData() {
  return callFn<{ url: string; recordings: number; truncated: boolean }>(
    "export-data",
    {},
  );
}

export async function ssoForEmail(
  email: string,
): Promise<{ sso: boolean; required: boolean }> {
  const { data } = await supabase.rpc("sso_for_email", { email });
  const r = (data as { sso: boolean; required: boolean }[] | null)?.[0];
  return r ?? { sso: false, required: false };
}

export async function joinDomainTeams(): Promise<number> {
  const { data } = await supabase.rpc("join_domain_teams");
  return Number(data ?? 0);
}

/** Email a team invite if the server has email set up; returns false otherwise. */
export async function emailInvite(code: string): Promise<boolean> {
  try {
    return (await callFn<{ sent: boolean }>("admin/email-invite", { code }))
      .sent;
  } catch {
    return false;
  }
}

// ---------- Highlight reels ----------

export type Reel = {
  id: string;
  user_id: string;
  workspace_id: string | null;
  title: string;
  share_token: string | null;
  created_at: string;
};
export type ReelItem = {
  id: string;
  playlist_id: string;
  recording_id: string;
  start_ms: number;
  end_ms: number;
  title: string | null;
  position: number;
  recordings?: { title: string } | null;
};

export async function listReels(): Promise<Reel[]> {
  const { data, error } = await supabase
    .from("playlists")
    .select("id, user_id, workspace_id, title, share_token, created_at")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as Reel[];
}

export async function createReel(
  title: string,
  workspaceId: string | null = null,
): Promise<string> {
  const { data, error } = await supabase
    .from("playlists")
    .insert({ title: title.trim(), workspace_id: workspaceId })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data.id as string;
}

export async function renameReel(id: string, title: string) {
  const { error } = await supabase
    .from("playlists")
    .update({ title: title.trim() })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

export async function deleteReel(id: string) {
  const { error } = await supabase.from("playlists").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

export async function reelItems(id: string): Promise<ReelItem[]> {
  const { data, error } = await supabase
    .from("playlist_items")
    .select(
      "id, playlist_id, recording_id, start_ms, end_ms, title, position, recordings(title)",
    )
    .eq("playlist_id", id)
    .order("position")
    .order("created_at");
  if (error) throw new Error(error.message);
  return (
    (data ?? []) as unknown as (ReelItem & {
      recordings: { title: string } | { title: string }[] | null;
    })[]
  ).map((r) => ({ ...r, recordings: one(r.recordings) }));
}

export async function addToReel(
  reelId: string,
  clip: {
    recording_id: string;
    start_ms: number;
    end_ms: number;
    title?: string | null;
  },
) {
  const { data: last } = await supabase
    .from("playlist_items")
    .select("position")
    .eq("playlist_id", reelId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  const { error } = await supabase.from("playlist_items").insert({
    playlist_id: reelId,
    recording_id: clip.recording_id,
    start_ms: Math.max(0, Math.round(clip.start_ms)),
    end_ms: Math.round(clip.end_ms),
    title: clip.title?.slice(0, 200) ?? null,
    position: (last?.position ?? -1) + 1,
  });
  if (error) throw new Error(error.message);
}

export async function removeReelItem(id: string) {
  const { error } = await supabase.from("playlist_items").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

/** Swap two clips' places. */
export async function swapReelItems(a: ReelItem, b: ReelItem) {
  const r1 = await supabase
    .from("playlist_items")
    .update({ position: b.position })
    .eq("id", a.id);
  const r2 = await supabase
    .from("playlist_items")
    .update({ position: a.position })
    .eq("id", b.id);
  if (r1.error || r2.error) throw new Error((r1.error ?? r2.error)!.message);
}

export async function setReelSharing(
  id: string,
  enabled: boolean,
): Promise<string | null> {
  const { data, error } = await supabase.rpc("set_playlist_sharing", {
    pid: id,
    enabled,
  });
  if (error) throw new Error(error.message);
  return (data as string | null) ?? null;
}

export function reelUrl(token: string) {
  return `${APP_URL || (isWeb ? window.location.origin : "")}/h/${token}`;
}

// ---------- RingCentral ----------

export async function ringcentralAvailable(): Promise<boolean> {
  const { data, error } = await supabase.functions.invoke(
    "ringcentral/available",
    { method: "GET" },
  );
  return !error && Boolean(data?.available);
}

export async function startRingCentral(returnTo: string): Promise<string> {
  return (
    await callFn<{ url: string }>("ringcentral/start", { return_to: returnTo })
  ).url;
}
