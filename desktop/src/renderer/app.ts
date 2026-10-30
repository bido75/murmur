// Desktop UI: sign in → set up a recording → record → upload. Plain DOM, no framework.
import type { Bridge } from "../shared/bridge";
import { DEFAULT_SETTINGS, type Settings } from "../shared/settings";
import {
  applyServerPrefs,
  effectiveDefaultType,
  needsServerPush,
  serverPatchFrom,
  type ServerPrefs,
} from "../shared/settingsSync";
import {
  CHECKLIST_TOTAL,
  checklistProgress,
  desktopChecklist,
  rowToChecklistData,
  stampFor,
  type ChecklistItem,
  type OnboardingRow,
} from "./onboarding";
import { pendingSegments } from "../shared/queue";
import { MEETING_LABELS, type MeetingApp } from "../shared/meetings";
import { Capture } from "./capture";
import { h } from "./dom";
import { startLive } from "./live";
import { APP_NAME, APP_URL } from "./config";
import { isConfigured, supabase } from "./supabase";
import { onSpeechProgress, speech } from "./speech";
import { onDictation, transcribeRecording, type HistoryEntry } from "./dictation";
import { dictationPanel, dictationSettings } from "./dictationView";
import { useHistory } from "./historyPanel";
import { historyPanel, historyState, setHistoryActions } from "./historyView";
import { initSpeech, speechPanel } from "./speechPanel";
import type { Shortcut } from "../shared/shortcuts";
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
  ["phone_call", "Phone call"],
  ["site_walk", "Site walk"],
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
  view: "loading" | "signin" | "home" | "recording" | "settings";
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
  /** The dictation history is open. */
  showHistory: boolean;
  /** The dictation settings are open. */
  showDictation: boolean;
  onboarding: {
    items: ChecklistItem[];
    done: number;
    total: number;
    hidden: boolean;
  } | null;
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
  showHistory: false,
  showDictation: false,
  onboarding: null,
};
let capture: Capture | null = null;
let recordingId: string | null = null;

// The account-wide settings, cached locally and reconciled with user_settings.
let appSettings: Settings = { ...DEFAULT_SETTINGS };
/** What the server last had, so we only push real changes. */
let lastSyncedRow: Partial<ServerPrefs> | null = null;

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

// ---------- account-wide settings ----------

/** Pull user_settings from the account, merge into the local store and adopt them. */
async function loadServerPrefs() {
  const { data } = await supabase
    .from("user_settings")
    .select("consent_reminder,field_mode,default_template,my_state")
    .maybeSingle();
  const row = (data ?? null) as Partial<ServerPrefs> | null;
  const local = await bridge().settingsGet();
  appSettings = applyServerPrefs(local, row);
  await bridge().settingsSet({ ...appSettings });
  lastSyncedRow = row;
  state.form.template = effectiveDefaultType(appSettings);
  render();
}

/** Apply a settings change locally; account-wide fields are pushed when signed in. */
async function changeSettings(patch: Record<string, unknown>) {
  appSettings = { ...appSettings, ...patch } as Settings;
  await bridge().settingsSet(patch);
  if (needsServerPush(appSettings, lastSyncedRow)) {
    const serverPatch = serverPatchFrom(patch);
    if (Object.keys(serverPatch).length) {
      const { error } = await supabase.from("user_settings").upsert(serverPatch);
      if (!error) lastSyncedRow = { ...lastSyncedRow, ...serverPatch };
    }
  }
}

/** Load what the getting-started checklist still needs, from real data. */
async function loadOnboarding() {
  const [recordings, projects, onboarding] = await Promise.all([
    supabase.from("recordings").select("id", { count: "exact", head: true }),
    supabase.from("projects").select("id", { count: "exact", head: true }),
    supabase
      .from("user_onboarding")
      .select(
        "checklist_hidden,first_ready_opened_at,first_task_action_at,first_search_at,tour_version_seen",
      )
      .maybeSingle(),
  ]);
  const data = rowToChecklistData(
    (onboarding.data ?? null) as OnboardingRow,
    { recordings: recordings.count ?? 0, projects: projects.count ?? 0 },
  );
  const items = desktopChecklist(data);
  state.onboarding = {
    items,
    done: checklistProgress(items).done,
    total: checklistProgress(items).total,
    hidden: Boolean((onboarding.data as OnboardingRow)?.checklist_hidden),
  };
}

async function hideOnboarding() {
  state.onboarding = state.onboarding
    ? { ...state.onboarding, hidden: true }
    : state.onboarding;
  await supabase.from("user_onboarding").upsert({ checklist_hidden: true });
  await supabase
    .from("onboarding_events")
    .insert({ event: "checklist_hidden" });
}

/** Google sign-in through the system browser; the code comes back over "auth:code". */
async function startOAuth() {
  state.busy = true;
  state.error = null;
  render();
  try {
    const { redirectUri } = await bridge().authBegin();
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { skipBrowserRedirect: true, redirectTo: redirectUri },
    });
    if (error || !data?.url) {
      state.error = error?.message ?? "Sign-in could not start.";
      state.busy = false;
      render();
      return;
    }
    state.busy = false;
    await bridge().authOpen(data.url);
  } catch (e) {
    state.error = (e as Error).message;
    state.busy = false;
  }
  render();
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
        : state.view === "settings"
          ? settingsView()
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
          h(
            "button",
            {
              class: "ghost",
              disabled: state.busy,
              onclick: () => void startOAuth(),
            },
            "Continue with Google",
          ),
        ),
    state.error && h("div", { class: "banner" }, state.error),
  ];
}

/** The settings screen: account-wide fields write through to user_settings. */
function settingsView(): Child[] {
  const s = appSettings;
  const checkbox = (
    label: string,
    checked: boolean,
    onToggle: (v: boolean) => void,
    hint?: string,
  ) =>
    h(
      "label",
      { class: "row" },
      h("input", {
        type: "checkbox",
        checked,
        onchange: (e: Event) =>
          onToggle((e.target as HTMLInputElement).checked),
      }),
      h("span", {}, label),
      hint ? h("span", { class: "muted" }, hint) : null,
    );
  const typeSelect = h(
    "select",
    {
      "aria-label": "Default recording type",
      onchange: (e: Event) => {
        const v = (e.target as HTMLSelectElement).value;
        state.form.template = v;
        void changeSettings({ defaultRecordingType: v }).then(render);
      },
    },
    ...TEMPLATES.map(([v, l]) =>
      h("option", { value: v, selected: v === s.defaultRecordingType }, l),
    ),
  );
  return [
    h(
      "div",
      { class: "item" },
      h("h1", {}, "Settings"),
      h(
        "button",
        {
          class: "ghost",
          onclick: () => {
            state.view = "home";
            render();
          },
        },
        "Back",
      ),
    ),
    h(
      "div",
      { class: "card" },
      h("strong", {}, "Recording"),
      h("div", { class: "row" }, h("label", {}, "Default type"), typeSelect),
      checkbox(
        "Remind me to ask before recording",
        s.consentReminder,
        (v) => void changeSettings({ consentReminder: v }).then(render),
        "Follows you on every device",
      ),
      checkbox(
        "Field mode",
        s.fieldMode,
        (v) => void changeSettings({ fieldMode: v }).then(render),
        `Gloves-friendly; new recordings start as ${
          TEMPLATES.find(
            ([id]) => id === effectiveDefaultType({ ...s, fieldMode: true }),
          )?.[1] ?? "site walk"
        }`,
      ),
      h("input", {
        type: "text",
        placeholder: "My state or consent code",
        value: s.myState,
        "aria-label": "My state or consent code",
        maxlength: 64,
        onchange: (e: Event) =>
          void changeSettings({
            myState: (e.target as HTMLInputElement).value.trim(),
          }).then(render),
      }),
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
        "div",
        {},
        h(
          "button",
          {
            class: "ghost",
            onclick: () => {
              state.view = "settings";
              render();
            },
          },
          "Settings",
        ),
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
    ),
    state.onboarding &&
      !state.onboarding.hidden &&
      state.onboarding.done < state.onboarding.total &&
      h(
        "div",
        { class: "card" },
        h(
          "strong",
          {},
          `Getting started (${state.onboarding.done}/${state.onboarding.total})`,
        ),
        ...state.onboarding.items
          .filter((i) => !i.done)
          .map((i) => h("p", { class: "muted" }, i.title)),
        h(
          "button",
          {
            class: "ghost",
            onclick: () => void hideOnboarding().then(render),
          },
          "Hide this list",
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
      appSettings.consentReminder &&
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
    h(
      "button",
      {
        class: "ghost",
        onclick: () => {
          state.showDictation = !state.showDictation;
          state.showHistory = false;
          render();
        },
      },
      state.showDictation ? "Hide the dictation settings" : "Dictation",
    ),
    h(
      "button",
      {
        class: "ghost",
        onclick: () => {
          state.showHistory = !state.showHistory;
          state.showDictation = false;
          if (state.showHistory) void dictationHistoryApi.load().then(render);
          render();
        },
      },
      state.showHistory ? "Hide the dictation history" : "Dictation history",
    ),
    ...(state.showDictation ? dictationPanel(render, saveShortcuts) : []),
    ...(state.showHistory ? historyPanel(render) : []),
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
                    onclick: () => {
                      // Opening a recording counts as "open your notes" on the
                      // shared checklist, on every app at once.
                      const stamp = stampFor("open_notes");
                      if (stamp)
                        void supabase
                          .from("user_onboarding")
                          .upsert(stamp)
                          .then(() => void loadOnboarding().catch(() => {}));
                      void bridge().openExternal(
                        `${APP_URL}/recording/${r.id}`,
                      );
                    },
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
                ext: s.ext,
                offsetMs: s.offsetMs,
                durationMs: s.durationMs,
              })
            : enqueue({
                kind: "segment",
                recordingId: id,
                idx: s.idx,
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

// ---------- Dictation ----------

/**
 * The dictation history.
 *
 * It is set up once, so the panel and the shortcut can both reach it.
 */
const dictationHistoryApi = useHistory({
  changed: (entries: HistoryEntry[]) => {
    historyState.entries = entries;
    render();
  },
  error: (message) => {
    state.error = message;
    render();
  },
});

/**
 * Save the shortcuts the user chose.
 *
 * The main process registers them and says which ones the operating system would not
 * give us, so the user is told rather than left wondering.
 */
async function saveShortcuts(shortcuts: Shortcut[]) {
  dictationSettings.shortcuts = shortcuts;
  const result = (await bridge().dictationShortcuts(shortcuts)) as {
    ok: boolean;
    failed: string[];
  } | null;
  dictationSettings.refused = result?.failed ?? [];
  if (result && !result.ok)
    state.error = `Another program is using ${result.failed.join(", ")}, so it could not be taken.`;
  render();
}

/** Read the dictation settings from the main process. */
async function loadDictationSettings() {
  const settings = (await bridge().dictationSettings()) as {
    shortcuts: Shortcut[];
    insertMethod: "clipboard" | "paste" | "type";
    keepHistory: boolean;
  } | null;
  if (!settings) return;
  dictationSettings.shortcuts = settings.shortcuts ?? [];
  dictationSettings.insertMethod = settings.insertMethod ?? "paste";
  dictationSettings.keepHistory = settings.keepHistory ?? true;
}

/**
 * The dictation recording.
 *
 * It is not a meeting: nothing is queued for upload and nothing appears in the
 * library. The words go where the user is typing, and the audio on this computer is
 * thrown away as soon as the words are made.
 */
let dictationCapture: Capture | null = null;
let dictationId: string | null = null;
let dictationWords: { text: string; utterances: { start_ms: number; end_ms: number; speaker: number; text: string }[] }[] = [];
let dictationStartedAt = 0;

async function startDictation() {
  if (dictationCapture) return;
  dictationId = uuid();
  dictationWords = [];
  dictationStartedAt = Date.now();
  dictationCapture = new Capture(
    dictationId,
    {
      onSegment: async (s) => {
        try {
          const bytes = await bridge().fileRead(
            dictationId!,
            s.idx,
            s.ext,
          );
          const language = (
            await supabase
              .from("user_settings")
              .select("language")
              .maybeSingle()
          ).data?.language as string | null;
          dictationWords.push(
            await transcribeRecording(bytes, s.offsetMs, language ?? null),
          );
        } catch (e) {
          await bridge().dictationFail((e as Error).message);
        } finally {
          // The audio on this computer is not needed once the words are made.
          await bridge().fileDelete(dictationId!, s.idx, s.ext);
        }
      },
      onWarning: (w) => {
        if (w) void bridge().dictationFail(w);
      },
      onLevel: (db) => {
        // The level is shown as a bar, from 0 to 1.
        const level = Math.max(0, Math.min(1, (db + 60) / 60));
        void bridge().dictationLevel(level, Date.now() - dictationStartedAt);
      },
    },
    speech.local,
  );
  try {
    // Only the microphone: a dictation is one person talking.
    await dictationCapture.start(false, false);
  } catch (e) {
    dictationCapture = null;
    await bridge().dictationFail((e as Error).message);
  }
}

async function stopDictation() {
  if (!dictationCapture || !dictationId) return;
  const id = dictationId;
  const cap = dictationCapture;
  dictationCapture = null;
  dictationId = null;
  await cap.stop();
  const text = dictationWords
    .flatMap((w) => w.utterances)
    .map((u) => u.text)
    .join(" ")
    .trim();
  const tookMs = Date.now() - dictationStartedAt;
  await bridge().dictationComplete(
    text,
    tookMs,
    speech.local ? "parakeet" : "cloud",
    speech.local,
  );
}

function cancelDictation() {
  if (!dictationCapture) return;
  void dictationCapture.stop();
  dictationCapture = null;
  dictationId = null;
  dictationWords = [];
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
  // The account's preferences win over whatever this device had cached.
  void loadServerPrefs().catch(() => {
    /* Offline: the cached settings stay in force and sync resumes later. */
  });
  void loadOnboarding().catch(() => {
    /* Offline or the tables are not migrated yet: the card simply stays away. */
  });
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
  const segments: { idx: number; ext: string; durationMs: number }[] = [];
  const cap = new Capture(id, {
    onSegment: async (s) => {
      segments.push(s);
    },
    onWarning: () => {},
    onLevel: () => {},
  });
  await cap.start(false);
  await new Promise((r) => setTimeout(r, 6000));
  const active = (await bridge().activeGet()) as {
    recordingId: string;
    idx: number;
    ext: string;
  } | null;
  const midSize = active
    ? await bridge().fileSize(active.recordingId, active.idx, active.ext)
    : -1;
  const total = await cap.stop();
  const size = segments[0]
    ? await bridge().fileSize(id, segments[0].idx, segments[0].ext)
    : -1;
  const head = segments[0]
    ? Array.from(
        (await bridge().fileRead(id, segments[0].idx, segments[0].ext)).slice(0, 4),
      )
    : [];
  console.error(
    `SELFTEST ${JSON.stringify({ segments: segments.length, midRecordingBytes: midSize, finalBytes: size, totalMs: total, webmMagic: head.map((b) => b.toString(16)).join(""), activeCleared: (await bridge().activeGet()) === null })}`,
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

  // OAuth sign-in: the main process caught the browser's redirect and hands us the
  // code; Supabase's stored PKCE verifier is what makes it worth anything.
  bridge().on("auth:code", (code) => {
    void supabase.auth
      .exchangeCodeForSession(String(code))
      .then(async ({ error }) => {
        if (error) {
          state.error = error.message;
          if (state.view !== "home") render();
          return;
        }
        await goHome();
      });
  });

  // The speech model, and whether new recordings are made on this computer.
  await initSpeech();
  await loadDictationSettings();
  onSpeechProgress(() => {
    if (state.view === "home") render();
  });

  // Dictation: the main process says when to record and when to stop.
  setHistoryActions({
    load: dictationHistoryApi.load,
    copy: dictationHistoryApi.copy,
    remove: dictationHistoryApi.remove,
    clear: dictationHistoryApi.clear,
  });
  onDictation({
    start: () => startDictation(),
    stop: () => stopDictation(),
    cancel: () => cancelDictation(),
    level: (level, elapsedMs) =>
      void bridge().dictationLevel(level, elapsedMs),
    complete: async (text, tookMs, provider, local) => {
      await bridge().dictationComplete(text, tookMs, provider, local);
    },
    fail: (reason) => {
      state.error = reason;
      render();
    },
    history: () => {
      state.view = "home";
      state.showHistory = true;
      render();
    },
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
