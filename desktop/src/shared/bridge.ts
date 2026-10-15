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
  macAudioStart(): Promise<{ ok: boolean; error?: string; sampleRate?: number }>;
  macAudioStop(): Promise<void>;
  on(channel: 'macaudio:data' | 'macaudio:status' | 'meeting:detected' | 'meeting:state' | 'tray:start' | 'tray:stop', fn: (payload: unknown) => void): () => void;
};
