// Desktop UI: sign in → set up a recording → record → upload. Plain DOM, no framework.
import type { Bridge } from "../shared/bridge";
import { pendingSegments } from "../shared/queue";
import { MEETING_LABELS, type MeetingApp } from "../shared/meetings";
import { Capture } from "./capture";
import { h } from "./dom";
import { startLive } from "./live";
import { APP_NAME, APP_URL } from "./config";
import { isConfigured, supabase } from "./supabase";
import { onSpeechProgress, speech } from "./speech";
import { initSpeech, speechPanel } from "./speechPanel";
import {
  enqueue,
  flush,
  getQueue,
  onQueueChange,
  recoverInterrupted,
} from "./sync";

declare const window: Window & { murmur: Bridge };
const bridge = () => window.murmur;

const TEMPLATES: [string, string][] = [
  ["meeting", "Meeting"],
  ["sales_call", "Sales call"],
  ["interview", "Interview"],
  ["lecture", "Lecture"],
  ["general", "General"],
];
const CONSENT: [string, string][] = [
  ["told_everyone", "I told everyone at the start"],
  ["in_invite", "The notice was in the invite or agenda"],
  ["solo", "Only my own voice (notes to self)"],
];
const NOTICE =
  "I'm recording this call so I can take accurate notes — is everyone okay with that?";

type State = {
  view: "loading" | "signin" | "home" | "recording";
  email: string;
  codeSent: boolean;
  error: string | null;
  projects: { id: string; name: string }[];
  recent: { id: string; title: string; status: string; created_at: string }[];
  pending: number;
  meeting: MeetingApp | null;
  form: {
    title: string;
    projectId: string;
    template: string;
    system: boolean;
    screen: boolean;
    consent: string;
  };
  warning: string | null;
  level: number;
  busy: boolean;
};

const state: State = {
  view: "loading",
  email: "",
  codeSent: false,
  error: null,
  projects: [],
  recent: [],
  pending: 0,
  meeting: null,
  form: {
    title: "",
    projectId: "",
    template: "meeting",
    system: true,
    screen: false,
    consent: "",
  },
  warning: null,
  level: -90,
  busy: false,
};
let capture: Capture | null = null;
let recordingId: string | null = null;

// ---------- tiny DOM helpers ----------

type Child = Node | string | null | false | undefined;
const root = () => document.getElementById("app")!;
const clock = (ms: number) => {
  const s = Math.floor(ms / 1000);
  const hh = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(hh ? 2 : 1, "0");
  return `${hh ? `${hh}:` : ""}${mm}:${String(s % 60).padStart(2, "0")}`;
};

function uuid(): string {
  return crypto.randomUUID();
}

// ---------- views ----------

function render() {
  const r = root();
  r.replaceChildren();
  if (!isConfigured) {
    r.append(
      h("h1", {}, APP_NAME),
      h(
        "div",
        { class: "banner" },
        "This build has no server settings. Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY in ../.env and rebuild.",
      ),
    );
    return;
  }
  if (state.view === "loading")
    r.append(h("p", { class: "muted" }, "Loading…"));
  const parts =
    state.view === "signin"
      ? signInView()
      : state.view === "home"
        ? homeView()
        : state.view === "recording"
          ? recordingView()
          : [];
  for (const c of parts) if (c) r.append(c);
}

function signInView(): Child[] {
  const email = h("input", {
    type: "email",
    placeholder: "you@company.com",
    value: state.email,
    "aria-label": "Email address",
    autocomplete: "email",
  }) as HTMLInputElement;
  const code = h("input", {
    type: "text",
    class: "code",
    placeholder: "000000",
    maxlength: "6",
    inputmode: "numeric",
    "aria-label": "Sign-in code",
    autocomplete: "one-time-code",
  }) as HTMLInputElement;
  return [
    h("h1", {}, APP_NAME),
    h(
      "p",
      { class: "muted" },
      "Records meetings on this computer. No bot joins the call.",
    ),
    state.codeSent
      ? h(
          "div",
          { class: "card" },
          h("p", {}, `Enter the 6-digit code sent to ${state.email}.`),
          code,
          h(
            "button",
            {
              class: "primary",
              disabled: state.busy,
              onclick: async () => {
                state.busy = true;
                render();
                const { error } = await supabase.auth.verifyOtp({
                  email: state.email,
                  token: code.value.trim(),
                  type: "email",
                });
                state.busy = false;
                state.error = error?.message ?? null;
                if (!error) await goHome();
                else render();
              },
            },
            "Sign in",
          ),
          h(
            "button",
            {
              class: "ghost",
              onclick: () => {
                state.codeSent = false;
                render();
              },
            },
            "Use a different email",
          ),
        )
      : h(
          "div",
          { class: "card" },
          email,
          h(
            "button",
            {
              class: "primary",
              disabled: state.busy,
              onclick: async () => {
                state.email = email.value.trim();
                state.busy = true;
                render();
                const { error } = await supabase.auth.signInWithOtp({
                  email: state.email,
                  options: { shouldCreateUser: true },
                });
                state.busy = false;
                state.error = error?.message ?? null;
                state.codeSent = !error;
                render();
              },
            },
            "Email me a sign-in code",
          ),
        ),
    state.error && h("div", { class: "banner" }, state.error),
  ];
}

function homeView(): Child[] {
  const f = state.form;
  const select = (
    value: string,
    options: [string, string][],
    onchange: (v: string) => void,
    label: string,
  ) =>
    h(
      "select",
      {
        "aria-label": label,
        onchange: (e: Event) => onchange((e.target as HTMLSelectElement).value),
      },
      ...options.map(([v, l]) =>
        h("option", { value: v, selected: v === value }, l),
      ),
    );
  const canRecord = Boolean(f.consent);

  return [
    h(
      "div",
      { class: "item" },
      h("h1", {}, APP_NAME),
      h(
        "button",
        {
          class: "ghost",
          onclick: () =>
            void supabase.auth.signOut().then(() => {
              state.view = "signin";
              render();
            }),
        },
        "Sign out",
      ),
    ),
    state.meeting &&
      h(
        "div",
        { class: "banner info" },
        `${MEETING_LABELS[state.meeting]} meeting in progress. Ready to record it.`,
      ),
    h(
      "div",
      { class: "card" },
      h("input", {
        type: "text",
        placeholder: "Title (optional)",
        value: f.title,
        "aria-label": "Title",
        oninput: (e: Event) => (f.title = (e.target as HTMLInputElement).value),
      }),
      h(
        "div",
        { class: "row2" },
        select(
          f.projectId,
          [
            ["", "No project"],
            ...state.projects.map((p) => [p.id, p.name] as [string, string]),
          ],
          (v) => (f.projectId = v),
          "Project",
        ),
        select(f.template, TEMPLATES, (v) => (f.template = v), "Type"),
      ),
      h(
        "label",
        { class: "row" },
        h("input", {
          type: "checkbox",
          checked: f.system,
          onchange: (e: Event) =>
            (f.system = (e.target as HTMLInputElement).checked),
        }),
        h("span", {}, "Include computer audio (the other people on the call)"),
      ),
      h(
        "label",
        { class: "row" },
        h("input", {
          type: "checkbox",
          checked: f.screen,
          onchange: (e: Event) =>
            (f.screen = (e.target as HTMLInputElement).checked),
        }),
        h(
          "span",
          {},
          "Also record my screen (for demos, walkthroughs and slides)",
        ),
      ),
      h("p", { class: "muted" }, "Use headphones for the cleanest recording."),
    ),
    h(
      "div",
      { class: "card" },
      h("strong", {}, "Let people know"),
      h(
        "p",
        { class: "muted" },
        `Many places require everyone's permission to record. You can say: “${NOTICE}”`,
      ),
      ...CONSENT.map(([v, l]) =>
        h(
          "label",
          { class: "row" },
          h("input", {
            type: "radio",
            name: "consent",
            checked: f.consent === v,
            onchange: () => {
              f.consent = v;
              render();
            },
          }),
          h("span", {}, l),
        ),
      ),
    ),
    h(
      "button",
      {
        class: "record",
        disabled: !canRecord || state.busy,
        onclick: () => void startRecording(),
      },
      "● Record",
    ),
    ...speechPanel(render),
    state.error && h("div", { class: "banner" }, state.error),
    state.pending > 0 &&
      h(
        "p",
        { class: "muted" },
        `${state.pending} audio part${state.pending > 1 ? "s" : ""} waiting to upload.`,
      ),
    state.recent.length > 0 && h("h2", {}, "Recent"),
    state.recent.length > 0 &&
      h(
        "div",
        { class: "list" },
        ...state.recent.map((r) =>
          h(
            "div",
            { class: "card item" },
            h(
              "div",
              {},
              h("div", {}, r.title),
              h(
                "div",
                { class: "muted" },
                new Date(r.created_at).toLocaleString(),
              ),
            ),
            APP_URL
              ? h(
                  "button",
                  {
                    class: "ghost",
                    onclick: () =>
                      void bridge().openExternal(
                        `${APP_URL}/recording/${r.id}`,
                      ),
                  },
                  r.status === "ready" ? "Open" : r.status,
                )
              : h(
                  "span",
                  { class: r.status === "ready" ? "pill ok" : "pill" },
                  r.status,
                ),
          ),
        ),
      ),
  ];
}

function recordingView(): Child[] {
  const pct = Math.max(0, Math.min(100, ((state.level + 60) / 60) * 100));
  return [
    h(
      "p",
      { class: "muted", style: "text-align:center" },
      h("span", { class: "dot" }),
      capture?.paused ? "Paused" : "Recording",
    ),
    h("div", { class: "timer", id: "timer" }, clock(capture?.elapsedMs ?? 0)),
    h(
      "div",
      { class: "meter", "aria-label": "Input level" },
      h("div", { id: "level", style: `width:${pct}%` }),
    ),
    h(
      "p",
      { class: "muted", style: "text-align:center" },
      `Recording your ${capture?.hasVideo ? "screen, " : ""}${capture?.systemAudio === "on" ? "mic and computer audio" : "mic"}`,
    ),
    state.warning && h("div", { class: "banner" }, state.warning),
    stopLive
      ? h(
          "div",
          { class: "live", id: "live", "aria-live": "polite" },
          h("p", { class: "muted" }, "Listening…"),
        )
      : h(
          "button",
          { class: "secondary", onclick: () => void toggleLive() },
          "Show live transcript",
        ),
    h(
      "div",
      { class: "row2" },
      h(
        "button",
        {
          class: "secondary",
          onclick: () => {
            if (capture?.paused) capture.resume();
            else capture?.pause();
            render();
          },
        },
        capture?.paused ? "Resume" : "Pause",
      ),
      h(
        "button",
        { class: "record", onclick: () => void stopRecording() },
        "Stop",
      ),
    ),
    h(
      "p",
      { class: "muted", style: "text-align:center" },
      "Saved to disk every few seconds. Closing this window keeps recording in the menu bar / tray.",
    ),
  ];
}

// ---------- actions ----------

async function startRecording() {
  state.busy = true;
  state.error = null;
  render();
  const f = state.form;
  recordingId = uuid();
  try {
    const id = recordingId;
    capture = new Capture(
      id,
      {
        onSegment: (s) =>
          // On this computer: the part is transcribed here and the audio is not
          // uploaded. Otherwise it is uploaded and the server transcribes it.
          speech.local
            ? enqueue({
                kind: "local_segment",
                recordingId: id,
                idx: s.idx,
                path: s.path,
                offsetMs: s.offsetMs,
                durationMs: s.durationMs,
              })
            : enqueue({
                kind: "segment",
                recordingId: id,
                idx: s.idx,
                path: s.path,
                ext: s.ext,
                durationMs: s.durationMs,
                video: f.screen,
              }),
        onWarning: (w) => {
          state.warning = w;
          render();
        },
        onLevel: (db) => {
          state.level = db;
        },
      },
      speech.local,
    );
    await capture.start(f.system, f.screen);
    // Created after capture starts, so it knows whether the call's audio has its own channel.
    // (Parts are only queued when they finish, so this still runs first.)
    await enqueue({
      kind: "create",
      recordingId,
      title:
        f.title.trim() ||
        (state.meeting
          ? `${MEETING_LABELS[state.meeting]} meeting`
          : "New recording"),
      template: f.template,
      projectId: f.projectId || null,
      consentMethod: f.consent,
      consentAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      video: f.screen,
      channels: capture.channels,
    });
    state.view = "recording";
    state.warning = state.warning ?? null;
    await bridge().setRecording(true);
  } catch (e) {
    state.error = (e as Error).message;
    capture = null;
  } finally {
    state.busy = false;
    render();
  }
}

let stopLive: (() => void) | null = null;

async function toggleLive() {
  if (stopLive) {
    stopLive();
    stopLive = null;
    render();
    return;
  }
  const stream = capture?.stream;
  if (!stream) return;
  stopLive = () => {};
  render();
  stopLive = await startLive(
    stream,
    (lines) => {
      const el = document.getElementById("live");
      if (el)
        el.replaceChildren(
          ...lines.map(
            (l) => h("p", { class: l.final ? "" : "muted" }, l.text) as Node,
          ),
        );
    },
    (m) => {
      state.warning = m;
      stopLive = null;
      render();
    },
  );
}

async function stopRecording() {
  if (!capture || !recordingId) return;
  stopLive?.();
  stopLive = null;
  const id = recordingId;
  const total = await capture.stop();
  await enqueue(
    speech.local
      ? { kind: "local_finalize", recordingId: id, durationMs: total }
      : { kind: "finalize", recordingId: id, durationMs: total },
  );
  capture = null;
  recordingId = null;
  state.view = "home";
  state.warning = null;
  state.form.title = "";
  state.form.consent = "";
  await bridge().setRecording(false);
  render();
  void refresh();
}

async function refresh() {
  const [projects, recent, queue] = await Promise.all([
    supabase
      .from("projects")
      .select("id, name")
      .eq("archived", false)
      .order("created_at", { ascending: false }),
    supabase
      .from("recordings")
      .select("id, title, status, created_at")
      .order("created_at", { ascending: false })
      .limit(5),
    getQueue(),
  ]);
  state.projects = (projects.data ?? []) as State["projects"];
  state.recent = (recent.data ?? []) as State["recent"];
  state.pending = pendingSegments(queue);
  if (state.view === "home") render();
}

async function goHome() {
  state.view = "home";
  render();
  if (await recoverInterrupted()) {
    state.error = null;
    state.warning = null;
    root().prepend(
      h(
        "div",
        { class: "banner info" },
        "The app closed during a recording. What was captured is saved and uploading.",
      ),
    );
  }
  void flush();
  await refresh();
}

// ---------- boot ----------

/** Test-only (MURMUR_SELFTEST): record ~6 s from the fake mic and check the file on disk. */
async function selfTest() {
  const id = uuid();
  const segments: { path: string; durationMs: number }[] = [];
  const cap = new Capture(id, {
    onSegment: async (s) => {
      segments.push(s);
    },
    onWarning: () => {},
    onLevel: () => {},
  });
  await cap.start(false);
  await new Promise((r) => setTimeout(r, 6000));
  const midSize = await bridge().fileSize(
    ((await bridge().activeGet()) as { path: string }).path,
  );
  const total = await cap.stop();
  const size = segments[0] ? await bridge().fileSize(segments[0].path) : -1;
  const head = segments[0]
    ? Array.from((await bridge().fileRead(segments[0].path)).slice(0, 4))
    : [];
  console.error(
    `SELFTEST ${JSON.stringify({ segments: segments.length, midRecordingBytes: midSize, finalBytes: size, totalMs: total, webmMagic: head.map((b) => b.toString(16)).join(""), activeCleared: (await bridge().activeGet()) === null, path: segments[0]?.path })}`,
  );
}

async function boot() {
  if (location.hash === "#selftest") {
    await selfTest().catch((e) =>
      console.error(`SELFTEST error ${(e as Error).message}`),
    );
    return;
  }
  // Live timer and level without re-rendering the whole view.
  setInterval(() => {
    if (state.view !== "recording" || !capture) return;
    const t = document.getElementById("timer");
    if (t) t.textContent = clock(capture.elapsedMs);
    const l = document.getElementById("level");
    if (l)
      l.style.width = `${Math.max(0, Math.min(100, ((state.level + 60) / 60) * 100))}%`;
  }, 250);
  setInterval(() => void flush(), 30_000);
  onQueueChange(
    () =>
      void getQueue().then((q) => {
        state.pending = pendingSegments(q);
        if (state.view === "home") render();
      }),
  );

  bridge().on("meeting:state", (m) => {
    state.meeting = (m as MeetingApp | null) ?? null;
    if (state.view === "home") render();
  });
  bridge().on("meeting:detected", (m) => {
    state.meeting = m as MeetingApp;
    if (state.view === "home") render();
  });
  bridge().on("tray:start", () => {
    if (state.view === "home" && state.form.consent) void startRecording();
  });
  bridge().on("tray:stop", () => void stopRecording());

  // The speech model, and whether new recordings are made on this computer.
  await initSpeech();
  onSpeechProgress(() => {
    if (state.view === "home") render();
  });

  if (!isConfigured) return render();
  const { data } = await supabase.auth.getSession();
  if (data.session) await goHome();
  else {
    state.view = "signin";
    render();
  }
}

void boot();
