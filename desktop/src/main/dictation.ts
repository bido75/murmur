// Dictation: the shortcuts, the floating overlay, and putting the words where the user
// is typing.
//
// The window is a web page, so it is not trusted with the microphone or with the
// keyboard. The main process owns the shortcuts and the overlay, and tells the window
// what to do; the window records and gives the words back.
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { app, BrowserWindow, clipboard, globalShortcut, screen } from "electron";
import {
  DEFAULT_SHORTCUTS,
  toElectronAccelerator,
  type Shortcut,
  type ShortcutAction,
} from "../shared/shortcuts";
import {
  clipboardSettleMs,
  insertFallbackMessage,
  pasteCommand,
  type InsertMethod,
  type Platform,
} from "../shared/insert";
import {
  addEntry,
  clearHistory,
  entryText,
  removeEntry,
  searchHistory,
  type HistoryEntry,
} from "../shared/history";

/** Where the overlay's cancel button is, so the main process knows when it is under the pointer. */
export type OverlayRect = { x: number; y: number; w: number; h: number };

/** What the app is doing right now. */
export type DictationState = "idle" | "recording" | "working" | "error";

/** What the overlay shows. */
export type OverlayState = {
  state: DictationState;
  /** How loud the microphone is, from 0 to 1. */
  level: number;
  /** How long the recording has been going, in milliseconds. */
  elapsedMs: number;
  /** How far through the transcription, from 0 to 100. */
  progress: number;
  /** Something went wrong, in words. */
  error: string | null;
  /** The words, once they are ready. */
  text: string | null;
};

const IDLE: OverlayState = {
  state: "idle",
  level: 0,
  elapsedMs: 0,
  progress: 0,
  error: null,
  text: null,
};

export type DictationSettings = {
  shortcuts: Shortcut[];
  /** How the words get to where the user is typing. */
  insertMethod: InsertMethod;
  /** Keep the history on the computer. */
  keepHistory: boolean;
};

const DEFAULT_SETTINGS: DictationSettings = {
  shortcuts: DEFAULT_SHORTCUTS,
  insertMethod: "paste",
  keepHistory: true,
};

const SETTINGS_FILE = "dictation.json";
const HISTORY_FILE = "history.json";

function storePath(name: string): string {
  return join(app.getPath("userData"), name);
}

function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

function writeJson(file: string, value: unknown): void {
  try {
    mkdirSync(app.getPath("userData"), { recursive: true });
    writeFileSync(file, JSON.stringify(value), "utf8");
  } catch {
    // A note that cannot be written only costs a little.
  }
}

/**
 * The dictation.
 *
 * It holds the settings, the history and the overlay, and it is the only thing that
 * touches the keyboard or the clipboard.
 */
export class Dictation {
  private settings: DictationSettings = DEFAULT_SETTINGS;
  private history: HistoryEntry[] = [];
  private overlay: BrowserWindow | null = null;
  private state: OverlayState = { ...IDLE };
  /** The window that does the recording. */
  private target: BrowserWindow | null = null;
  /** The words from the last dictation, for "put it back". */
  private lastText: string | null = null;
  /** Set when the overlay's cancel button is under the pointer. */
  private overlayInteractive = false;

  constructor(target: BrowserWindow) {
    this.target = target;
    this.settings = {
      ...DEFAULT_SETTINGS,
      ...readJson<Partial<DictationSettings>>(storePath(SETTINGS_FILE), {}),
    };
    this.history = readJson<HistoryEntry[]>(storePath(HISTORY_FILE), []);
  }

  /** The settings, for the window. */
  getSettings(): DictationSettings {
    return this.settings;
  }

  /** The history, for the window. */
  getHistory(): HistoryEntry[] {
    return this.history;
  }

  /** What the overlay is showing. */
  getState(): OverlayState {
    return this.state;
  }

  // ---------- The shortcuts ----------

  /**
   * Register the shortcuts.
   *
   * A shortcut that the operating system will not give us is refused, and the reason
   * is passed back so the user is told rather than left wondering.
   */
  registerShortcuts(): { ok: boolean; failed: string[] } {
    globalShortcut.unregisterAll();
    const failed: string[] = [];
    for (const shortcut of this.settings.shortcuts) {
      const accelerator = toElectronAccelerator(shortcut.binding);
      if (!accelerator) {
        failed.push(shortcut.binding);
        continue;
      }
      const ok = globalShortcut.register(accelerator, () =>
        this.onShortcut(shortcut.action),
      );
      if (!ok) failed.push(shortcut.binding);
    }
    return { ok: failed.length === 0, failed };
  }

  /** Take the shortcuts away, for when the app closes. */
  unregisterShortcuts(): void {
    globalShortcut.unregisterAll();
  }

  /** Change the shortcuts and register them again. */
  async setShortcuts(shortcuts: Shortcut[]): Promise<{ ok: boolean; failed: string[] }> {
    this.settings = { ...this.settings, shortcuts };
    writeJson(storePath(SETTINGS_FILE), this.settings);
    return this.registerShortcuts();
  }

  /** Change how the words get to where the user is typing. */
  setInsertMethod(method: InsertMethod): void {
    this.settings = { ...this.settings, insertMethod: method };
    writeJson(storePath(SETTINGS_FILE), this.settings);
  }

  /** Turn the history on or off, and clear it if it is turned off. */
  setKeepHistory(keep: boolean): void {
    this.settings = { ...this.settings, keepHistory: keep };
    writeJson(storePath(SETTINGS_FILE), this.settings);
    if (!keep) this.clearHistory();
  }

  private onShortcut(action: ShortcutAction): void {
    switch (action) {
      case "record":
        this.toggle();
        break;
      case "cancel":
        this.cancel();
        break;
      case "pasteLast":
        if (this.lastText) void this.insert(this.lastText);
        break;
      case "history":
        this.target?.webContents.send("dictation:history");
        break;
    }
  }

  // ---------- Recording ----------

  /** Start or stop a dictation. */
  toggle(): void {
    if (this.state.state === "recording") this.stop();
    else this.start();
  }

  /** Start a dictation. */
  start(): void {
    if (this.state.state === "recording") return;
    this.setState({ ...IDLE, state: "recording" });
    this.showOverlay();
    this.target?.webContents.send("dictation:start");
  }

  /** Stop a dictation and make the words. */
  stop(): void {
    if (this.state.state !== "recording") return;
    this.setState({ ...this.state, state: "working", progress: 0 });
    this.target?.webContents.send("dictation:stop");
  }

  /** Stop and throw the recording away. */
  cancel(): void {
    this.setState({ ...IDLE });
    this.hideOverlay();
    this.target?.webContents.send("dictation:cancel");
  }

  /** The recording is going: the level and the time are shown in the overlay. */
  reportLevel(level: number, elapsedMs: number): void {
    if (this.state.state !== "recording") return;
    this.setState({ ...this.state, level, elapsedMs });
  }

  /** The words are ready. */
  async complete(text: string, tookMs: number, provider: string, local: boolean): Promise<void> {
    this.lastText = text;
    if (this.settings.keepHistory && text.trim()) {
      this.history = addEntry(this.history, {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        at: Date.now(),
        text,
        tookMs,
        provider,
        local,
      });
      writeJson(storePath(HISTORY_FILE), this.history);
    }
    this.setState({ ...this.state, state: "idle", progress: 100, text });
    await this.insert(text);
    this.hideOverlay();
  }

  /** Something went wrong. */
  fail(reason: string): void {
    this.setState({ ...this.state, state: "error", error: reason });
    this.target?.webContents.send("dictation:error", reason);
  }

  // ---------- The overlay ----------

  private showOverlay(): void {
    if (this.overlay && !this.overlay.isDestroyed()) {
      this.overlay.showInactive();
      return;
    }
    const win = new BrowserWindow({
      width: 320,
      height: 110,
      frame: false,
      transparent: true,
      resizable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      focusable: false,
      show: false,
      webPreferences: {
        preload: join(__dirname, "overlayPreload.js"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    this.overlay = win;
    void win.loadFile(join(__dirname, "renderer", "overlay.html"));
    // The overlay never takes the focus, so it cannot steal it from the app the user
    // is typing in.
    win.setIgnoreMouseEvents(true, { forward: true });
    win.once("ready-to-show", () => {
      win.showInactive();
      this.sendOverlay();
    });
    win.on("closed", () => {
      this.overlay = null;
    });
  }

  private hideOverlay(): void {
    if (this.overlay && !this.overlay.isDestroyed()) this.overlay.hide();
  }

  /** Send the state to the overlay. */
  private sendOverlay(): void {
    if (this.overlay && !this.overlay.isDestroyed())
      this.overlay.webContents.send("overlay:state", this.state);
  }

  /**
   * The overlay's cancel button is under the pointer, so the overlay stops swallowing
   * the clicks. Everywhere else it is see-through, so it does not get in the way of the
   * app the user is working in.
   */
  setOverlayInteractive(interactive: boolean): void {
    if (interactive === this.overlayInteractive) return;
    this.overlayInteractive = interactive;
    if (this.overlay && !this.overlay.isDestroyed())
      this.overlay.setIgnoreMouseEvents(!interactive, { forward: true });
  }

  /** Where the pointer is, so the overlay can work out whether it is over a button. */
  cursorPoint(): { x: number; y: number } {
    return screen.getCursorScreenPoint();
  }

  private setState(state: OverlayState): void {
    this.state = state;
    this.sendOverlay();
    this.target?.webContents.send("dictation:state", state);
  }

  // ---------- Putting the words where the user is typing ----------

  /**
   * Put the words on the clipboard and ask the system to paste them.
   *
   * The command is run with its arguments kept apart, and never through a shell, so a
   * word from the transcript can never become part of a command.
   */
  async insert(text: string): Promise<{ pasted: boolean; message?: string }> {
    const trimmed = text.trim();
    if (!trimmed) return { pasted: false, message: "There was nothing to paste." };
    clipboard.writeText(trimmed);

    const method = this.settings.insertMethod;
    if (method === "clipboard")
      return { pasted: false, message: insertFallbackMessage(method) };

    const platform = process.platform as Platform;
    const command = pasteCommand(platform, method);
    if (!command)
      return { pasted: false, message: insertFallbackMessage(method) };

    const ok = await runCommand(command.program, command.args);
    if (!ok)
      return { pasted: false, message: insertFallbackMessage(method) };
    return { pasted: true };
  }

  // ---------- The history ----------

  searchHistory(query: string): HistoryEntry[] {
    return searchHistory(this.history, query);
  }

  removeFromHistory(id: string): void {
    this.history = removeEntry(this.history, id);
    writeJson(storePath(HISTORY_FILE), this.history);
  }

  clearHistory(): void {
    this.history = clearHistory();
    writeJson(storePath(HISTORY_FILE), this.history);
  }

  /** Put a past dictation back on the clipboard. */
  copyFromHistory(id: string): boolean {
    const entry = this.history.find((e) => e.id === id);
    if (!entry) return false;
    clipboard.writeText(entryText(entry));
    return true;
  }
}

/**
 * Run a command and wait for it.
 *
 * The program and its arguments are passed straight to the operating system: there is
 * no shell, so nothing in them can be read as a command of its own.
 */
export function runCommand(program: string, args: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const child = spawn(program, args, { shell: false, stdio: "ignore" });
      child.on("error", () => resolve(false));
      child.on("close", (code) => resolve(code === 0));
    } catch {
      resolve(false);
    }
  });
}

/** How long the clipboard needs to settle on this system. */
export { clipboardSettleMs };
