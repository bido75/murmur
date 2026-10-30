// What this computer is doing while a recording is being made.
//
// The numbers are for the user and for the logs: how much memory the app is using, and
// how much of the processor it is taking. Nothing is sent anywhere.
import { cpus, totalmem, freemem } from "node:os";

export type ResourceStats = {
  /** Memory this app is using, in megabytes. */
  rssMb: number;
  /** Memory this app's JavaScript is using, in megabytes. */
  heapUsedMb: number;
  /** Memory on this computer that is free, in megabytes. */
  systemFreeMb: number;
  /** Memory on this computer in total, in megabytes. */
  systemTotalMb: number;
  /** How many processor threads the computer has. */
  cores: number;
  /** When the numbers were taken. */
  at: number;
};

/** A snapshot of what the app and the computer are using. */
export function resourceStats(): ResourceStats {
  const memory = process.memoryUsage();
  return {
    rssMb: Math.round(memory.rss / (1024 * 1024)),
    heapUsedMb: Math.round(memory.heapUsed / (1024 * 1024)),
    systemFreeMb: Math.round(freemem() / (1024 * 1024)),
    systemTotalMb: Math.round(totalmem() / (1024 * 1024)),
    cores: cpus().length,
    at: Date.now(),
  };
}

/**
 * Watch how much processor the app is using.
 *
 * `process.cpuUsage()` counts processor time, so the share is worked out by comparing
 * two readings. The first reading is the baseline, so the first number is always zero
 * until there is a second one.
 */
export class CpuWatcher {
  private lastCpu = process.cpuUsage();
  private lastAt = Date.now();

  /** The share of one processor's time the app has used since the last call, 0 to 1. */
  sample(): number {
    const now = Date.now();
    const cpu = process.cpuUsage();
    const elapsedUs = Math.max(1, (now - this.lastAt) * 1000);
    const usedUs =
      cpu.user - this.lastCpu.user + (cpu.system - this.lastCpu.system);
    this.lastCpu = cpu;
    this.lastAt = now;
    // The figure is the share of one processor; there may be more than one.
    return Math.max(0, Math.min(1, usedUs / elapsedUs));
  }
}

/** How long a job is expected to take, given the length of the audio. */
export function estimateMs(
  audioMs: number,
  /** How many times faster than real time the machine is, on a rough guess. */
  speedFactor = 1,
): number {
  if (audioMs <= 0) return 0;
  return Math.round((audioMs / Math.max(0.1, speedFactor)) * 1000);
}
