// Recordings whose notes were waiting get them as soon as there are minutes again.
import { markResuming, queuedRecordings } from './billing_store.ts';
import { runPipeline } from './pipeline.ts';

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void };

/** Start the notes for every recording that was put on hold. Returns how many. */
export async function resumeQueued(userId: string): Promise<number> {
  const ids = await queuedRecordings(userId);
  for (const id of ids) {
    await markResuming(id);
    EdgeRuntime.waitUntil(runPipeline(id));
  }
  return ids.length;
}
