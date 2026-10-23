// The only API the web page can use (exposed by preload.ts through contextBridge).
export type Bridge = {
  segmentOpen(recordingId: string, idx: number, ext: string): Promise<string>;
  segmentAppend(path: string, bytes: Uint8Array): Promise<void>;
  fileRead(path: string): Promise<Uint8Array>;
  fileSize(path: string): Promise<number>;
  fileDelete(path: string): Promise<void>;
  queueGet(): Promise<unknown[]>;
  queueSet(ops: unknown[]): Promise<void>;
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
  /**
   * Transcribe an audio file on this computer, without sending it anywhere.
   *
   * The main process runs the speech model; the file never leaves the machine and no
   * speech service is contacted. It refuses when the local runtime is not installed.
   */
  transcribeLocal(
    path: string,
    options?: { language?: string | null },
  ): Promise<{
    utterances: { start_ms: number; end_ms: number; speaker: number; text: string }[];
    durationMs: number;
    language: string | null;
  }>;
  on(
    channel:
      | "macaudio:data"
      | "macaudio:status"
      | "meeting:detected"
      | "meeting:state"
      | "tray:start"
      | "tray:stop",
    fn: (payload: unknown) => void,
  ): () => void;
};
