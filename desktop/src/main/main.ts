// Electron main process: window + tray, a local file store for audio segments and the
// upload queue (so recordings survive crashes and restarts), system audio capture, and
// meeting detection.
import {
  execFile,
  spawn,
  type ChildProcessWithoutNullStreams,
} from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import {
  app,
  BrowserWindow,
  desktopCapturer,
  ipcMain,
  Menu,
  nativeImage,
  Notification,
  session,
  shell,
  systemPreferences,
  Tray,
} from "electron";
import {
  detectBrowserMeeting,
  detectMeeting,
  MEETING_LABELS,
  parsePs,
  parseTasklist,
  shouldPrompt,
  type MeetingApp,
} from "../shared/meetings";
import {
  bundleSizeMb,
  DEFAULT_SPEECH_MODEL,
  modelMessage,
} from "../shared/speechModels";
import {
  installModel,
  installedFiles,
  removeModel,
} from "./speechModelManager";
import { resourceStats } from "./resources";
import { loadSettings, saveSettings } from "./settings";
import { runtimeMissingReason, transcribeSamples } from "./transcriber";
import { modelDir } from "./speechModelManager";
import { Dictation, type OverlayRect } from "./dictation";

const APP_NAME = "Murmur";
let win: BrowserWindow | null = null;
let tray: Tray | null = null;
let recording = false;
let lastMeeting: MeetingApp | null = null;
let macCapture: ChildProcessWithoutNullStreams | null = null;
/** The download that is running, so it can be stopped. */
let installAbort: AbortController | null = null;

// ---------- Local store (everything under userData/pending) ----------

const dataDir = () => join(app.getPath("userData"), "pending");
const queueFile = () => join(app.getPath("userData"), "queue.json");
const activeFile = () => join(app.getPath("userData"), "active.json");
/** Where the speech model is kept, next to the queue but outside the audio folder. */
const userDataDir = () => app.getPath("userData");
/** The words made from each part, until the whole recording is sent. */
const textFile = () => join(app.getPath("userData"), "text.json");

/** Whether the speech model is installed and the engine can be loaded. */
let engineReady: boolean | null = null;
function runtimeInstalled(): boolean {
  if (engineReady !== null) return engineReady;
  const dir = modelDir(DEFAULT_SPEECH_MODEL, userDataDir());
  engineReady = ["nemo128.onnx", "encoder-model.int8.onnx", "decoder_joint-model.int8.onnx", "vocab.txt"].every(
    (name) => existsSync(join(dir, name)),
  );
  return engineReady;
}

/** Dictation: the shortcuts, the overlay and the clipboard. */
let dictation: Dictation | null = null;

/** The calls the window makes about dictation. */
function registerDictationIpc() {
  ipcMain.handle("dictation:settings", () => dictation?.getSettings() ?? null);
  ipcMain.handle("dictation:history", () => dictation?.getHistory() ?? []);
  ipcMain.handle("dictation:state", () => dictation?.getState() ?? null);
  ipcMain.handle("dictation:search", (_e, q: string) =>
    dictation?.searchHistory(String(q ?? "")) ?? [],
  );
  ipcMain.handle("dictation:remove", (_e, id: string) => {
    dictation?.removeFromHistory(String(id ?? ""));
  });
  ipcMain.handle("dictation:clear", () => dictation?.clearHistory());
  ipcMain.handle("dictation:copy", (_e, id: string) =>
    Boolean(dictation?.copyFromHistory(String(id ?? ""))),
  );
  ipcMain.handle("dictation:keepHistory", (_e, keep: boolean) =>
    dictation?.setKeepHistory(Boolean(keep)),
  );
  ipcMain.handle("dictation:insertMethod", (_e, method: string) => {
    if (method === "clipboard" || method === "paste" || method === "type")
      dictation?.setInsertMethod(method);
  });
  ipcMain.handle("dictation:shortcuts", (_e, shortcuts: unknown) =>
    dictation?.setShortcuts(Array.isArray(shortcuts) ? shortcuts : []),
  );
  // The window has made the words: they go where the user is typing.
  ipcMain.handle(
    "dictation:complete",
    async (
      _e,
      text: string,
      tookMs: number,
      provider: string,
      local: boolean,
    ) => {
      const result = await dictation?.insert(String(text ?? ""));
      await dictation?.complete(
        String(text ?? ""),
        Number(tookMs) || 0,
        String(provider ?? "cloud"),
        Boolean(local),
      );
      return result;
    },
  );
  ipcMain.handle("dictation:fail", (_e, reason: string) =>
    dictation?.fail(String(reason ?? "Something went wrong.")),
  );
  ipcMain.handle("dictation:level", (_e, level: number, elapsedMs: number) =>
    dictation?.reportLevel(Number(level) || 0, Number(elapsedMs) || 0),
  );
  ipcMain.handle("dictation:pasteLast", async () => {
    const history = dictation?.getHistory() ?? [];
    const last = history[0];
    if (!last) return { pasted: false, message: "There is nothing to paste yet." };
    return dictation?.insert(last.text);
  });

  // The overlay is its own window with its own rules: it can show, cancel and say
  // where its button is, and nothing else.
  ipcMain.on("overlay:cancel", () => dictation?.cancel());
  ipcMain.on("overlay:hover", (_e, rect: OverlayRect) => {
    if (!dictation || !rect) return;
    // The pointer is over the cancel button, so the overlay stops swallowing the clicks.
    const point = dictation.cursorPoint();
    const over =
      point.x >= rect.x &&
      point.x <= rect.x + rect.w &&
      point.y >= rect.y &&
      point.y <= rect.y + rect.h;
    dictation.setOverlayInteractive(over);
  });
}

function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

/** Write atomically so a crash mid-write can't corrupt the queue. */
function writeJson(file: string, value: unknown) {
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(value));
  renameSync(tmp, file);
}

/**
 * The file a recording's part is kept in.
 *
 * The renderer never names a file. It says which recording and which part, and the
 * path is worked out here, so a page that has been tampered with cannot ask for a file
 * it did not make.
 */
function segmentPath(recordingId: string, idx: number, ext: string): string {
  if (
    !/^[0-9a-f-]{36}$/i.test(recordingId) ||
    !Number.isInteger(idx) ||
    idx < 1 ||
    idx > 2000 ||
    !/^[a-z0-9]{2,5}$/.test(ext)
  )
    throw new Error("Bad segment");
  return join(
    dataDir(),
    `${recordingId}-${String(idx).padStart(4, "0")}.${ext}`,
  );
}

function registerIpc() {
  ipcMain.handle(
    "segment:open",
    (_e, recordingId: string, idx: number, ext: string) => {
      const path = segmentPath(recordingId, idx, ext);
      mkdirSync(dataDir(), { recursive: true });
      writeFileSync(path, Buffer.alloc(0));
      return true;
    },
  );
  ipcMain.handle(
    "segment:append",
    (_e, recordingId: string, idx: number, ext: string, bytes: Uint8Array) => {
      appendFileSync(segmentPath(recordingId, idx, ext), Buffer.from(bytes));
    },
  );
  ipcMain.handle(
    "file:read",
    (_e, recordingId: string, idx: number, ext: string) =>
      new Uint8Array(readFileSync(segmentPath(recordingId, idx, ext))),
  );
  ipcMain.handle("file:size", (_e, recordingId: string, idx: number, ext: string) => {
    const p = segmentPath(recordingId, idx, ext);
    return existsSync(p) ? statSync(p).size : -1;
  });
  ipcMain.handle("file:delete", (_e, recordingId: string, idx: number, ext: string) => {
    const p = segmentPath(recordingId, idx, ext);
    if (existsSync(p)) rmSync(p);
  });
  ipcMain.handle("queue:get", () => readJson(queueFile(), []));
  ipcMain.handle("queue:set", (_e, ops: unknown[]) =>
    writeJson(queueFile(), ops),
  );
  ipcMain.handle("active:get", () => readJson(activeFile(), null));
  ipcMain.handle("active:set", (_e, value: unknown) => {
    if (value === null) {
      if (existsSync(activeFile())) rmSync(activeFile());
    } else writeJson(activeFile(), value);
  });
  ipcMain.handle("recording:state", (_e, isRecording: boolean) => {
    recording = isRecording;
    updateTray();
  });
  ipcMain.handle("app:info", () => ({
    platform: process.platform,
    version: app.getVersion(),
  }));
  ipcMain.handle("app:open-external", (_e, url: string) => {
    if (/^https:\/\//.test(url)) void shell.openExternal(url);
  });
  ipcMain.handle("mic:permission", async () => {
    if (process.platform !== "darwin") return true;
    return systemPreferences.askForMediaAccess("microphone");
  });

  // macOS system audio comes from a small ScreenCaptureKit helper that streams raw PCM.
  ipcMain.handle("macaudio:start", () => startMacCapture());
  ipcMain.handle("macaudio:stop", () => stopMacCapture());

  // ---------- A small store for the words made from each part ----------

  ipcMain.handle("text:get", (_e, key: string) => {
    const all = readJson<Record<string, string>>(textFile(), {});
    return all[key] ?? null;
  });
  ipcMain.handle("text:set", (_e, key: string, value: string) => {
    const all = readJson<Record<string, string>>(textFile(), {});
    all[key] = value;
    writeJson(textFile(), all);
  });
  ipcMain.handle("text:keys", (_e, prefix: string) => {
    const all = readJson<Record<string, string>>(textFile(), {});
    return Object.keys(all)
      .filter((k) => k.startsWith(prefix))
      .sort();
  });
  ipcMain.handle("text:remove", (_e, keys: string[]) => {
    const all = readJson<Record<string, string>>(textFile(), {});
    for (const k of keys) delete all[k];
    writeJson(textFile(), all);
  });

  // Transcribe on this computer. The audio never leaves the machine and no speech
  // service is contacted.
  ipcMain.handle(
    "transcribe:local",
    async (_e, samples: Float32Array, options?: { language?: string | null }) => {
      const result = await transcribeSamples(
        DEFAULT_SPEECH_MODEL,
        userDataDir(),
        samples,
        { language: options?.language ?? null },
      );
      return {
        utterances: result.utterances,
        durationMs: result.durationMs,
        language: result.language,
        tookMs: result.tookMs,
        resources: result.resources,
      };
    },
  );

  // ---------- The speech model ----------

  ipcMain.handle("speech:model", () => {
    const base = userDataDir();
    const bundle = DEFAULT_SPEECH_MODEL;
    const files = installedFiles(bundle, base);
    const message = modelMessage(bundle, files);
    return {
      id: bundle.id,
      label: bundle.label,
      note: bundle.note,
      attribution: bundle.attribution,
      sizeMb: bundleSizeMb(bundle),
      ready: message.ready,
      installed: files.some((f) => f.present),
      text: message.text,
      files: files.map((f) => ({
        name: f.name,
        present: f.present,
        sizeBytes: f.sizeBytes,
      })),
      engineAvailable: runtimeInstalled(),
      engineReason: runtimeInstalled()
        ? ""
        : "The speech model is not installed yet. Download it to transcribe on this computer.",
    };
  });

  ipcMain.handle("speech:install", async () => {
    const bundle = DEFAULT_SPEECH_MODEL;
    const base = userDataDir();
    // Only one download at a time: the cancel button stops this one.
    if (installAbort) installAbort.abort();
    const controller = new AbortController();
    installAbort = controller;
    try {
      const result = await installModel(bundle, base, {
        signal: controller.signal,
        onProgress: (p) =>
          win?.webContents.send("speech:progress", p),
      });
      return result;
    } finally {
      if (installAbort === controller) installAbort = null;
    }
  });

  ipcMain.handle("speech:cancel", () => {
    installAbort?.abort();
  });

  ipcMain.handle("speech:remove", () => {
    removeModel(DEFAULT_SPEECH_MODEL, userDataDir());
  });

  ipcMain.handle("app:resources", () => resourceStats());

  // Application settings: validated in the main process, stored atomically.
  ipcMain.handle("settings:get", () => loadSettings(userDataDir()));
  ipcMain.handle("settings:set", (_e, patch: unknown) =>
    saveSettings(
      userDataDir(),
      (typeof patch === "object" && patch !== null ? patch : {}) as Record<string, unknown>,
    ),
  );
}

// ---------- System audio ----------

/** Screen picker: the main screen, and on Windows the system audio ("loopback") with it. */
function registerDisplayMedia() {
  session.defaultSession.setDisplayMediaRequestHandler(
    async (_request, callback) => {
      try {
        const sources = await desktopCapturer.getSources({ types: ["screen"] });
        // The screen (kept only for screen recordings), plus system audio where Chromium supports
        // it (Windows "loopback"; macOS audio comes from the native helper instead).
        callback(
          process.platform === "win32"
            ? { video: sources[0], audio: "loopback" }
            : { video: sources[0] },
        );
      } catch {
        callback({});
      }
    },
  );
}

function helperPath(): string {
  // Packaged: Contents/Resources/SystemAudioCapture. Dev: desktop/native/macos/build/SystemAudioCapture.
  const packaged = join(process.resourcesPath, "SystemAudioCapture");
  return existsSync(packaged)
    ? packaged
    : join(app.getAppPath(), "native", "macos", "build", "SystemAudioCapture");
}

function startMacCapture(): {
  ok: boolean;
  error?: string;
  sampleRate?: number;
} {
  if (process.platform !== "darwin")
    return { ok: false, error: "Only on macOS" };
  stopMacCapture();
  const bin = helperPath();
  if (!existsSync(bin))
    return {
      ok: false,
      error: "System audio helper is missing. Run `npm run mac-helper`.",
    };
  macCapture = spawn(bin, [], { stdio: ["pipe", "pipe", "pipe"] });
  // stdout: raw little-endian float32 mono at 48 kHz, streamed to the renderer.
  macCapture.stdout.on("data", (chunk: Buffer) =>
    win?.webContents.send("macaudio:data", new Uint8Array(chunk)),
  );
  // stderr: one JSON status line per event (started, error).
  macCapture.stderr.on("data", (chunk: Buffer) => {
    for (const line of chunk.toString().split("\n").filter(Boolean)) {
      try {
        win?.webContents.send("macaudio:status", JSON.parse(line));
      } catch {
        /* ignore non-JSON logs */
      }
    }
  });
  macCapture.on("exit", (code) => {
    win?.webContents.send("macaudio:status", { event: "exit", code });
    macCapture = null;
  });
  return { ok: true, sampleRate: 48000 };
}

function stopMacCapture() {
  if (macCapture) {
    macCapture.stdin.end(); // the helper exits when stdin closes
    macCapture.kill("SIGTERM");
    macCapture = null;
  }
}

// ---------- Meeting detection ----------

function listProcesses(): Promise<string> {
  return new Promise((res) => {
    const [cmd, args] =
      process.platform === "win32"
        ? ["tasklist", ["/v", "/fo", "csv", "/nh"]]
        : ["ps", ["-axo", "comm="]];
    execFile(
      cmd,
      args,
      { maxBuffer: 8 * 1024 * 1024, windowsHide: true },
      (err, stdout) => res(err ? "" : stdout),
    );
  });
}

/** Titles of open windows (browsers show the active tab's title). macOS needs Screen Recording permission. */
async function windowTitles(): Promise<string[]> {
  try {
    const sources = await desktopCapturer.getSources({
      types: ["window"],
      thumbnailSize: { width: 0, height: 0 },
      fetchWindowIcons: false,
    });
    return sources.map((s) => s.name);
  } catch {
    return [];
  }
}

async function checkForMeeting() {
  const out = await listProcesses();
  const now =
    detectMeeting(
      process.platform === "win32" ? parseTasklist(out) : parsePs(out),
    ) ?? detectBrowserMeeting(await windowTitles());
  if (shouldPrompt(lastMeeting, now, recording) && Notification.isSupported()) {
    const label = MEETING_LABELS[now!];
    const n = new Notification({
      title: `${label} meeting detected`,
      body: `Record it with ${APP_NAME}? No bot joins the call.`,
    });
    n.on("click", () => {
      showWindow();
      win?.webContents.send("meeting:detected", now);
    });
    n.show();
  }
  if (now !== lastMeeting) win?.webContents.send("meeting:state", now);
  lastMeeting = now;
}

// ---------- Window and tray ----------

function showWindow() {
  if (!win) createWindow();
  win!.show();
  win!.focus();
}

function createWindow() {
  win = new BrowserWindow({
    width: 440,
    height: 720,
    minWidth: 380,
    minHeight: 560,
    title: APP_NAME,
    backgroundColor: "#F7F5F0",
    webPreferences: {
      preload: join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  void win.loadFile(
    join(__dirname, "renderer", "index.html"),
    process.env.MURMUR_SELFTEST ? { hash: "selftest" } : undefined,
  );
  // Dictation: the shortcuts, the overlay and the clipboard.
  if (win) dictation = new Dictation(win);
  registerDictationIpc();
  if (process.env.MURMUR_SELFTEST) {
    win.webContents.on("console-message", (_e, _level, message) => {
      if (message.startsWith("SELFTEST")) {
        console.log(message);
        app.exit(0);
      }
    });
  }
  // Test hook (CI smoke test): screenshot the first screen, report page errors, then quit.
  const shot = process.env.MURMUR_SMOKE_SHOT;
  if (shot) {
    win.webContents.on("console-message", (_e, level, message) => {
      if (level >= 2) console.log("[renderer]", message);
    });
    win.webContents.once("did-finish-load", () => {
      setTimeout(async () => {
        const img = await win!.webContents.capturePage();
        writeFileSync(shot, img.toPNG());
        const bridgeOk = await win!.webContents.executeJavaScript(
          'typeof window.murmur === "object" && typeof require === "undefined"',
        );
        console.log("SMOKE bridge-isolated", bridgeOk);
        app.exit(0);
      }, 2500);
    });
  }
  // Links open in the browser, never inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e) => e.preventDefault());
  // Closing the window keeps recording in the tray; quitting is explicit.
  win.on("close", (e) => {
    if (!(app as unknown as { quitting?: boolean }).quitting) {
      e.preventDefault();
      win?.hide();
    }
  });
}

function trayIcon() {
  // A small filled circle; red while recording.
  const color = recording ? "#D9472F" : "#1F6F5C";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><circle cx="16" cy="16" r="9" fill="${color}"/></svg>`;
  return nativeImage
    .createFromDataURL(
      `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`,
    )
    .resize({ width: 16, height: 16 });
}

function updateTray() {
  if (!tray) return;
  tray.setImage(trayIcon());
  tray.setToolTip(recording ? `${APP_NAME} — recording` : APP_NAME);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: `Open ${APP_NAME}`, click: showWindow },
      {
        label: recording ? "Stop recording" : "Start recording",
        click: () => {
          showWindow();
          win?.webContents.send(recording ? "tray:stop" : "tray:start");
        },
      },
      { type: "separator" },
      {
        label: "Quit",
        click: () => {
          (app as unknown as { quitting?: boolean }).quitting = true;
          app.quit();
        },
      },
    ]),
  );
}

// ---------- Lifecycle ----------

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", showWindow);
  app.whenReady().then(() => {
    // Microphone (and screen capture for system audio) only for our own pages.
    session.defaultSession.setPermissionRequestHandler((wc, permission, cb) => {
      cb(
        wc.getURL().startsWith("file://") &&
          (permission === "media" || permission === "display-capture"),
      );
    });
    registerIpc();
    registerDisplayMedia();
    createWindow();
    // The shortcuts are claimed once the window is there, so the first one works.
    win?.webContents.once("did-finish-load", () => {
      const result = dictation?.registerShortcuts();
      if (result && !result.ok)
        console.warn(
          `These shortcuts could not be taken: ${result.failed.join(", ")}. Another program is probably using them.`,
        );
    });
    tray = new Tray(trayIcon());
    tray.on("click", showWindow);
    updateTray();
    setInterval(() => void checkForMeeting(), 15_000);
    void checkForMeeting();
  });
  app.on("activate", showWindow);
  app.on("before-quit", () => {
    (app as unknown as { quitting?: boolean }).quitting = true;
    stopMacCapture();
    // The shortcuts belong to the app, so they are given back when it closes.
    dictation?.unregisterShortcuts();
  });
}
