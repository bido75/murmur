// Android on-device transcription: Android's built-in recorder can't write the 16 kHz WAV that
// whisper.cpp reads, so we take raw 16-bit PCM from the mic (react-native-audio-pcm-stream) and
// write the WAV ourselves. Audio is appended to disk as it arrives, so a crash loses at most a
// fraction of a second; repairWav() fixes the header of a file cut off mid-recording.
import { Buffer } from 'buffer';
import { File, FileMode } from 'expo-file-system';
import { Platform } from 'react-native';
import { pcmLevelDb, wavHeader } from './shared';

const RATE = 16000;
const BYTES_PER_SEC = RATE * 2;

type Stream = {
  init(o: { sampleRate: number; channels: number; bitsPerSample: number; audioSource?: number; bufferSize?: number; wavFile: string }): void;
  start(): void;
  stop(): Promise<string>;
  on(event: 'data', cb: (b64: string) => void): { remove(): void } | void;
};
let stream: Stream | null | undefined;

function pcmStream(): Stream | null {
  if (stream !== undefined) return stream;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const m = require('@fugood/react-native-audio-pcm-stream');
    stream = ((m.default ?? m) as Stream) ?? null;
  } catch {
    stream = null; // Expo Go or a build without the native module
  }
  return stream;
}

export function pcmRecorderAvailable(): boolean {
  return Platform.OS === 'android' && pcmStream() !== null;
}

function writeSizes(file: File, dataBytes: number) {
  const h = file.open(FileMode.ReadWrite);
  try {
    h.offset = 0;
    h.writeBytes(wavHeader(dataBytes, RATE));
  } finally {
    h.close();
  }
}

/** Fix the header of a WAV that was cut off (app killed mid-recording). Returns its duration. */
export function repairWav(uri: string): number {
  const f = new File(uri);
  if (!f.exists || f.size < 44) return 0;
  const data = f.size - 44;
  writeSizes(f, data);
  return Math.round((data / BYTES_PER_SEC) * 1000);
}

export class PcmWavRecorder {
  private file: File | null = null;
  private bytes = 0;
  private paused = false;
  private sub: { remove(): void } | void = undefined;
  level = -160;

  get durationMs(): number {
    return Math.round((this.bytes / BYTES_PER_SEC) * 1000);
  }

  /** Begin a new WAV file at `uri` (the mic keeps running across files). */
  start(uri: string) {
    const s = pcmStream();
    if (!s) throw new Error('On-device transcription isn’t available in this build.');
    const f = new File(uri);
    if (f.exists) f.delete();
    f.create();
    f.write(wavHeader(0, RATE));
    this.file = f;
    this.bytes = 0;
    this.paused = false;
    if (!this.sub) {
      s.init({ sampleRate: RATE, channels: 1, bitsPerSample: 16, audioSource: 6, bufferSize: 8192, wavFile: '' });
      this.sub = s.on('data', (b64) => this.onData(b64));
      s.start();
    }
  }

  private onData(b64: string) {
    if (this.paused || !this.file) return;
    const chunk = new Uint8Array(Buffer.from(b64, 'base64'));
    this.level = pcmLevelDb(chunk);
    const h = this.file.open(FileMode.Append);
    try {
      h.writeBytes(chunk);
    } finally {
      h.close();
    }
    this.bytes += chunk.length;
  }

  pause() {
    this.paused = true;
  }

  resume() {
    this.paused = false;
  }

  /** Close the current file (sizes written into its header). Returns its duration. */
  finishFile(): number {
    const f = this.file;
    this.file = null;
    if (f) writeSizes(f, this.bytes);
    return this.durationMs;
  }

  /** Stop the mic. */
  async release() {
    this.finishFile();
    this.sub?.remove();
    this.sub = undefined;
    await pcmStream()?.stop().catch(() => '');
  }
}
