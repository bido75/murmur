// Input level and silence detection, kept free of Electron and audio-node imports
// so the numbers the meter and the warnings rely on can be unit-tested.
//
// capture.ts feeds these the same analyser samples it always did; only the maths
// moved here.

/** RMS level of one channel of samples, in dBFS. Floor of -160 dB for digital silence. */
export function dbfs(samples: Float32Array): number {
  let sum = 0;
  for (const v of samples) sum += v * v;
  return 20 * Math.log10(Math.sqrt(sum / (samples.length || 1)) || 1e-8);
}

export type SilenceEvent = "warn" | "clear" | null;

/**
 * Warns once after the mic has been quiet for a while, and clears when it comes back.
 * Feeding the same quiet reading again does not warn twice.
 */
export class SilenceGuard {
  private since: number | null = null;
  private warned = false;
  private thresholdDb: number;
  private warnAfterMs: number;

  constructor(thresholdDb: number, warnAfterMs: number) {
    this.thresholdDb = thresholdDb;
    this.warnAfterMs = warnAfterMs;
  }

  /** Feed one reading; returns what the UI should do with its warning. */
  update(db: number, now: number): SilenceEvent {
    if (db < this.thresholdDb) {
      this.since ??= now;
      if (!this.warned && now - this.since > this.warnAfterMs) {
        this.warned = true;
        return "warn";
      }
      return null;
    }
    if (this.since !== null || this.warned) {
      this.since = null;
      this.warned = false;
      return "clear";
    }
    return null;
  }
}

/**
 * Which parts of a recording are worth keeping. A part under `minMs` is noise from
 * starting and stopping, not speech, and is deleted rather than uploaded.
 */
export function keepSegment(durationMs: number, minMs = 500): boolean {
  return durationMs > minMs;
}
