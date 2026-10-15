// Records the microphone mixed with system audio (the other people on the call) into
// WebM/Opus. Audio is appended to disk every few seconds and split into 5-minute files,
// so a crash or power cut loses at most a few seconds.
import type { Bridge } from '../shared/bridge';
import { CHUNK_MS, SEGMENT_MS, SILENCE_DB, SILENCE_WARN_MS } from './config';

declare const window: Window & { murmur: Bridge };
const bridge = () => window.murmur;

export type SegmentDone = { idx: number; path: string; ext: string; durationMs: number };
export type CaptureEvents = {
  onSegment: (s: SegmentDone) => Promise<void>;
  onWarning: (message: string | null) => void;
  onLevel: (db: number) => void;
};

const MIME = 'audio/webm;codecs=opus';
const EXT = 'webm';

export class Capture {
  private ctx: AudioContext | null = null;
  private dest: MediaStreamAudioDestinationNode | null = null;
  private analyser: AnalyserNode | null = null;
  private inputs: MediaStream[] = [];
  private recorder: MediaRecorder | null = null;
  private segIdx = 0;
  private segPath = '';
  private segActiveMs = 0;
  private segResumedAt = 0;
  private writes: Promise<void> = Promise.resolve();
  private timers: number[] = [];
  private offMac: (() => void) | null = null;
  private silenceSince: number | null = null;
  private rotating = false;
  doneMs = 0;
  systemAudio: 'on' | 'unavailable' | 'denied' = 'unavailable';

  constructor(private recordingId: string, private events: CaptureEvents) {}

  async start(withSystemAudio: boolean) {
    if (!(await bridge().micPermission())) throw new Error('Microphone access is off. Allow it in your system settings.');
    this.ctx = new AudioContext({ sampleRate: 48000 });
    this.dest = this.ctx.createMediaStreamDestination();
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 2048;

    const mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    this.inputs.push(mic);
    this.ctx.createMediaStreamSource(mic).connect(this.dest);
    this.ctx.createMediaStreamSource(mic).connect(this.analyser);

    if (withSystemAudio) await this.addSystemAudio();

    await this.openSegment();
    this.timers.push(window.setInterval(() => this.tick(), 500));
  }

  private async addSystemAudio() {
    const { platform } = await bridge().info();
    try {
      if (platform === 'win32') {
        // Main process answers with the screen + "loopback" (system) audio; we drop the video.
        const s = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
        s.getVideoTracks().forEach((t) => t.stop());
        if (!s.getAudioTracks().length) throw new Error('No system audio track');
        this.inputs.push(s);
        this.ctx!.createMediaStreamSource(s).connect(this.dest!);
        this.systemAudio = 'on';
      } else if (platform === 'darwin') {
        await this.ctx!.audioWorklet.addModule('pcm-worklet.js');
        const node = new AudioWorkletNode(this.ctx!, 'pcm-player', { numberOfInputs: 0, outputChannelCount: [1] });
        node.connect(this.dest!);
        let carry = new Uint8Array(0);
        const offData = bridge().on('macaudio:data', (payload) => {
          // Pipe chunks can split a 4-byte sample; carry the remainder to the next chunk.
          const chunk = payload as Uint8Array;
          const all = new Uint8Array(carry.length + chunk.length);
          all.set(carry);
          all.set(chunk, carry.length);
          const usable = all.length - (all.length % 4);
          carry = all.slice(usable);
          if (usable) node.port.postMessage(new Float32Array(all.slice(0, usable).buffer));
        });
        const offStatus = bridge().on('macaudio:status', (p) => {
          const s = p as { event: string; message?: string; permission?: boolean };
          if (s.event === 'error') {
            this.systemAudio = s.permission ? 'denied' : 'unavailable';
            this.events.onWarning(
              s.permission
                ? 'Allow Murmur under System Settings → Privacy & Security → Screen & System Audio Recording to capture the other people on the call. Recording your mic only for now.'
                : `System audio stopped: ${s.message ?? 'unknown error'}. Recording your mic only.`,
            );
          }
        });
        this.offMac = () => {
          offData();
          offStatus();
        };
        const r = await bridge().macAudioStart();
        if (!r.ok) throw new Error(r.error);
        this.systemAudio = 'on';
      }
    } catch (e) {
      this.systemAudio = 'unavailable';
      this.events.onWarning(`Couldn't capture computer audio (${(e as Error).message}). Recording your mic only.`);
    }
  }

  private async openSegment() {
    this.segIdx += 1;
    this.segPath = await bridge().segmentOpen(this.recordingId, this.segIdx, EXT);
    this.segActiveMs = 0;
    this.segResumedAt = Date.now();
    await bridge().activeSet({ recordingId: this.recordingId, idx: this.segIdx, path: this.segPath, doneMs: this.doneMs });
    const rec = new MediaRecorder(this.dest!.stream, { mimeType: MIME, audioBitsPerSecond: 64000 });
    const path = this.segPath;
    rec.ondataavailable = (e) => {
      if (!e.data.size) return;
      // Serialize writes so chunks land in order.
      this.writes = this.writes.then(async () => bridge().segmentAppend(path, new Uint8Array(await e.data.arrayBuffer())));
    };
    rec.start(CHUNK_MS);
    this.recorder = rec;
  }

  private segmentMs(): number {
    return this.segActiveMs + (this.recorder?.state === 'recording' ? Date.now() - this.segResumedAt : 0);
  }

  private async closeSegment() {
    const rec = this.recorder;
    if (!rec) return;
    const durationMs = this.segmentMs();
    await new Promise<void>((resolve) => {
      rec.onstop = () => resolve();
      rec.stop();
    });
    await this.writes;
    this.recorder = null;
    this.doneMs += durationMs;
    if (durationMs > 500) await this.events.onSegment({ idx: this.segIdx, path: this.segPath, ext: EXT, durationMs });
    else await bridge().fileDelete(this.segPath);
  }

  private tick() {
    if (!this.recorder || this.recorder.state !== 'recording' || this.rotating) return;
    if (this.segmentMs() >= SEGMENT_MS) {
      this.rotating = true;
      void this.closeSegment()
        .then(() => this.openSegment())
        .finally(() => (this.rotating = false));
      return;
    }
    // Input level (dBFS) for the meter and the silence warning.
    const data = new Float32Array(this.analyser!.fftSize);
    this.analyser!.getFloatTimeDomainData(data);
    let sum = 0;
    for (const v of data) sum += v * v;
    const db = 20 * Math.log10(Math.sqrt(sum / data.length) || 1e-8);
    this.events.onLevel(db);
    const now = Date.now();
    if (db < SILENCE_DB) {
      this.silenceSince ??= now;
      if (now - this.silenceSince > SILENCE_WARN_MS) this.events.onWarning("Not hearing your mic for a while. Check it isn't muted.");
    } else if (this.silenceSince !== null) {
      this.silenceSince = null;
      this.events.onWarning(null);
    }
  }

  get elapsedMs(): number {
    return this.doneMs + this.segmentMs();
  }

  get paused(): boolean {
    return this.recorder?.state === 'paused';
  }

  pause() {
    if (this.recorder?.state !== 'recording') return;
    this.segActiveMs += Date.now() - this.segResumedAt;
    this.recorder.pause();
  }

  resume() {
    if (this.recorder?.state !== 'paused') return;
    this.segResumedAt = Date.now();
    this.recorder.resume();
  }

  /** Stop everything; returns total recorded milliseconds. */
  async stop(): Promise<number> {
    this.timers.forEach((t) => clearInterval(t));
    this.timers = [];
    await this.closeSegment();
    await bridge().macAudioStop();
    this.offMac?.();
    this.inputs.forEach((s) => s.getTracks().forEach((t) => t.stop()));
    await this.ctx?.close();
    await bridge().activeSet(null);
    return this.doneMs;
  }
}
