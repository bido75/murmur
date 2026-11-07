// The only API the web page can use (exposed by preload.ts through contextBridge).
import type { Settings } from "./settings";

export type { Settings };
export type SpeechModelStatus = {
  id: string;
  label: string;
  note: string;
  /** Who must be credited for the model, and under what licence. */
  attribution: string;
  /** How big the model is, in megabytes. */
  sizeMb: number;
  /** Every file is there and has been checked. */
  ready: boolean;
  /** Something is there, but it is not all of the model. */
  installed: boolean;
  /** What to tell the user, in plain words. */
  text: string;
  files: { name: string; present: boolean; sizeBytes: number }[];
  /** Whether the engine that runs the model is installed. */
  engineAvailable: boolean;
  /** Why the engine cannot be used, if it cannot. */
  engineReason: string;
};

export type SpeechModelProgress = {
  /** Whole percentage of the whole model, from 0 to 100. */
  percent: number;
  /** The file being fetched. */
  file: string;
  stage: "downloading" | "verifying" | "done";
};

export type ResourceStats = {
  rssMb: number;
  heapUsedMb: number;
  systemFreeMb: number;
  systemTotalMb: number;
  cores: number;
  at: number;
};

export type Bridge = {
  /**
   * Start a new part of a recording.
   *
   * The renderer names the recording and the part, never a file: the path is worked
   * out in the main process, so a page that has been tampered with cannot ask for a
   * file it did not make.
   */
  segmentOpen(recordingId: string, idx: number, ext: string): Promise<boolean>;
  segmentAppend(
    recordingId: string,
    idx: number,
    ext: string,
    bytes: Uint8Array,
  ): Promise<void>;
  fileRead(
    recordingId: string,
    idx: number,
    ext: string,
  ): Promise<Uint8Array>;
  fileSize(recordingId: string, idx: number, ext: string): Promise<number>;
  fileDelete(recordingId: string, idx: number, ext: string): Promise<void>;
  queueGet(): Promise<unknown[]>;
  queueSet(ops: unknown[]): Promise<void>;
  /** Which account the upload queue belongs to, if any. */
  queueOwner(): Promise<string | null>;
  /** Quarantine the previous account's queue and adopt this one. */
  queueRotate(userId: string): Promise<boolean>;
  /** A small store for the words made from each part, until the whole recording is sent. */
  textGet(key: string): Promise<string | null>;
  textSet(key: string, value: string): Promise<void>;
  textKeys(prefix: string): Promise<string[]>;
  textRemove(keys: string[]): Promise<void>;
  activeGet(): Promise<unknown | null>;
  activeSet(value: unknown | null): Promise<void>;
  setRecording(isRecording: boolean): Promise<void>;
  info(): Promise<{ platform: string; version: string }>;
  openExternal(url: string): Promise<void>;
  micPermission(): Promise<boolean>;
  macAudioStart(): Promise<{
    ok: boolean;
    error?: string;
    sampleRate?: number;
  }>;
  macAudioStop(): Promise<void>;
  /** What the speech model is and whether it is ready to use. */
  speechModel(): Promise<SpeechModelStatus>;
  /** Start downloading the speech model. Progress arrives on the "speech:progress" channel. */
  speechModelInstall(): Promise<{ ok: true } | { ok: false; reason: string }>;
  /** Stop a download that is running. */
  speechModelCancel(): Promise<void>;
  /** Remove the speech model from this computer. */
  speechModelRemove(): Promise<void>;
  /**
   * Transcribe audio on this computer.
   *
   * `samples` is one channel of numbers at 16 kHz. Nothing is sent anywhere: the audio
   * is read by the model here. Refuses, in plain words, when the engine is not installed.
   */
  transcribeLocal(
    samples: Float32Array,
    options?: { language?: string | null },
  ): Promise<{
    utterances: { start_ms: number; end_ms: number; speaker: number; text: string }[];
    durationMs: number;
    language: string | null;
    tookMs: number;
    resources: ResourceStats;
  }>;
  /** What this app and this computer are using. */
  resources(): Promise<ResourceStats>;
  /** Durable application settings; patches are validated in the main process. */
  settingsGet(): Promise<Settings>;
  settingsSet(patch: Record<string, unknown>): Promise<Settings>;
  /**
   * Start OAuth sign-in: reserves the loopback redirect URI the provider will call.
   * The renderer builds the authorize URL with Supabase and passes it to authOpen.
   */
  authBegin(): Promise<{ redirectUri: string }>;
  /** Open the authorize URL in the user's browser. */
  authOpen(url: string): Promise<void>;
  /** The optional always-on-top controller shown while recording. */
  floatingShow(): Promise<void>;
  floatingHide(): Promise<void>;
  floatingUpdate(elapsedMs: number, level: number): Promise<void>;
  /** The OS-protected store for session tokens (DPAPI/Keychain/libsecret). */
  secureGet(key: string): Promise<string | null>;
  secureSet(key: string, value: string): Promise<boolean>;
  secureRemove(key: string): Promise<boolean>;
  /** Update-check status; the gate stays shut until signed installers are verified. */
  updatesStatus(): Promise<{
    enabled: boolean;
    reason: string;
    channel: string;
    currentVersion: string;
    latestVersion: string | null;
    error: string | null;
  }>;
  /** Dictation: the settings, the history and the state. */
  dictationSettings(): Promise<unknown>;
  dictationHistory(): Promise<unknown[]>;
  dictationState(): Promise<unknown>;
  dictationSearch(query: string): Promise<unknown[]>;
  dictationRemove(id: string): Promise<void>;
  dictationClear(): Promise<void>;
  dictationCopy(id: string): Promise<boolean>;
  dictationKeepHistory(keep: boolean): Promise<void>;
  dictationInsertMethod(method: string): Promise<void>;
  dictationShortcuts(shortcuts: unknown[]): Promise<unknown>;
  /** The words are ready: the main process puts them where the user is typing. */
  dictationComplete(
    text: string,
    tookMs: number,
    provider: string,
    local: boolean,
  ): Promise<unknown>;
  dictationFail(reason: string): Promise<void>;
  dictationLevel(level: number, elapsedMs: number): Promise<void>;
  dictationPasteLast(): Promise<unknown>;
  on(
    channel:
      | "macaudio:data"
      | "macaudio:status"
      | "meeting:detected"
      | "meeting:state"
      | "speech:progress"
      | "dictation:start"
      | "dictation:stop"
      | "dictation:cancel"
      | "dictation:error"
      | "dictation:history"
      | "tray:start"
      | "tray:stop"
      | "auth:code",
    fn: (payload: unknown) => void,
  ): () => void;
};
