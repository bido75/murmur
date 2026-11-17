// A recording's transcript and notes, shown in the desktop app.
//
// The data comes from the same tables the web app reads (transcripts, summaries),
// protected by the same row-level security, so the desktop sees exactly the
// recordings this account may see and nothing else.

import { h, type Child } from "./dom";
import { supabase } from "./supabase";

export type Utterance = { start_ms: number; end_ms: number; speaker: number; text: string };

export type TranscriptState = {
  loading: boolean;
  error: string | null;
  recordingId: string | null;
  title: string;
  createdAt: string | null;
  utterances: Utterance[];
  speakerNames: string[] | null;
  overview: string | null;
  keyPoints: string[];
  decisions: { text: string }[];
  openQuestions: string[];
  /** Whether the audio lives on this computer only (local recording). */
  localOnly: boolean;
};

export const transcriptState: TranscriptState = {
  loading: false,
  error: null,
  recordingId: null,
  title: "",
  createdAt: null,
  utterances: [],
  speakerNames: null,
  overview: null,
  keyPoints: [],
  decisions: [],
  openQuestions: [],
  localOnly: false,
};

export function resetTranscript() {
  transcriptState.loading = true;
  transcriptState.error = null;
  transcriptState.recordingId = null;
  transcriptState.title = "";
  transcriptState.createdAt = null;
  transcriptState.utterances = [];
  transcriptState.speakerNames = null;
  transcriptState.overview = null;
  transcriptState.keyPoints = [];
  transcriptState.decisions = [];
  transcriptState.openQuestions = [];
  transcriptState.localOnly = false;
}

const stamp = (ms: number) => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

const nameFor = (state: TranscriptState, speaker: number) =>
  state.speakerNames?.[speaker] ?? `Speaker ${speaker + 1}`;

/** Fetch one recording's words and notes; every failure is shown, never hidden. */
export async function loadTranscript(recordingId: string, title: string, localOnly = false) {
  resetTranscript();
  transcriptState.recordingId = recordingId;
  transcriptState.title = title || "Recording";
  transcriptState.localOnly = localOnly;

  const [rec, tr, sum] = await Promise.all([
    supabase.from("recordings").select("title,created_at").eq("id", recordingId).maybeSingle(),
    supabase.from("transcripts").select("utterances,speaker_names").eq("recording_id", recordingId).maybeSingle(),
    supabase
      .from("summaries")
      .select("overview,key_points,decisions,open_questions")
      .eq("recording_id", recordingId)
      .maybeSingle(),
  ]);

  if (rec.error || tr.error || sum.error) {
    transcriptState.loading = false;
    transcriptState.error =
      rec.error?.message ?? tr.error?.message ?? sum.error?.message ?? "The recording could not be read.";
    return transcriptState;
  }
  if (rec.data) {
    transcriptState.title = rec.data.title || transcriptState.title;
    transcriptState.createdAt = rec.data.created_at ?? null;
  }
  const raw = (tr.data?.utterances ?? null) as Utterance[] | null;
  transcriptState.utterances = Array.isArray(raw) ? raw : [];
  transcriptState.speakerNames = (tr.data?.speaker_names ?? null) as string[] | null;
  transcriptState.overview = (sum.data?.overview as string | undefined) ?? null;
  transcriptState.keyPoints = (sum.data?.key_points as string[] | undefined) ?? [];
  transcriptState.decisions = (sum.data?.decisions as { text: string }[] | undefined) ?? [];
  transcriptState.openQuestions = (sum.data?.open_questions as string[] | undefined) ?? [];
  transcriptState.loading = false;
  return transcriptState;
}

/** Words kept on this computer are not shown here yet; the card says so plainly. */

export function transcriptPanel(onClose: () => void): Child[] {
  const s = transcriptState;
  if (s.loading) return [h("p", { class: "muted" }, "Loading…")];
  if (s.error) return [h("div", { class: "banner" }, s.error)];
  const copy = (text: string) => void navigator.clipboard.writeText(text);
  const parts: Child[] = [
    h(
      "div",
      { class: "item" },
      h("h1", {}, s.title),
      h(
        "button",
        { class: "ghost", onclick: () => onClose() },
        "Back",
      ),
    ),
  ];
  if (s.overview) parts.push(h("div", { class: "card" }, h("strong", {}, "Overview"), h("p", {}, s.overview)));
  if (s.keyPoints.length)
    parts.push(
      h(
        "div",
        { class: "card" },
        h("strong", {}, "Key points"),
        ...s.keyPoints.map((k) => h("p", { class: "muted" }, `• ${k}`)),
      ),
    );
  if (s.decisions.length)
    parts.push(
      h(
        "div",
        { class: "card" },
        h("strong", {}, "Decisions"),
        ...s.decisions.map((d) => h("p", { class: "muted" }, `• ${d.text}`)),
      ),
    );
  if (s.openQuestions.length)
    parts.push(
      h(
        "div",
        { class: "card" },
        h("strong", {}, "Open questions"),
        ...s.openQuestions.map((q) => h("p", { class: "muted" }, `• ${q}`)),
      ),
    );
  if (s.localOnly)
    parts.push(
      h(
        "div",
        { class: "banner info" },
        "This recording was made on this computer. Its words stay here until you choose to send it.",
      ),
    );
  if (s.utterances.length)
    parts.push(
      h(
        "div",
        { class: "card" },
        h("strong", {}, "Transcript"),
        ...s.utterances.map((u) =>
          h(
            "div",
            { class: "row" },
            h(
              "button",
              {
                class: "ghost",
                "aria-label": `Copy words at ${stamp(u.start_ms)}`,
                onclick: () => copy(u.text),
              },
              stamp(u.start_ms),
            ),
            h("span", { class: "muted" }, nameFor(s, u.speaker)),
            h("span", {}, u.text),
          ),
        ),
      ),
    );
  if (!s.utterances.length && !s.overview && !s.localOnly)
    parts.push(h("div", { class: "banner info" }, "The words are not ready yet. They arrive when processing finishes."));
  return parts;
}
