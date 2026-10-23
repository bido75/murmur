// Installing the speech model on this computer: download it, check it, and know what
// state it is in afterwards.
//
// Nothing here trusts the download. Each file is checked against the size and the
// SHA-256 published by the file's host before it is used, and a download that was
// interrupted is never mistaken for a good one. The check is remembered, so the app
// does not re-hash 650 MB on every launch.
//
// The audio never leaves the computer: this only fetches the model.
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { Sha256 } from "../../../supabase/functions/_shared/sha256.ts";
import {
  bundleProgressPercent,
  fileState,
  modelFolderName,
  verifySpeechFile,
  type InstalledFile,
  type SpeechModelBundle,
} from "../shared/speechModels.ts";

/** How the model manager reports what it is doing. */
export type InstallProgress = {
  /** Whole percentage of the whole model, from 0 to 100. */
  percent: number;
  /** The file being fetched. */
  file: string;
  stage: "downloading" | "verifying" | "done";
};

export type InstallOptions = {
  onProgress?: (p: InstallProgress) => void;
  /** Stops the download when it is aborted. */
  signal?: AbortSignal;
};

/** Where the model is kept. */
export function modelDir(bundle: SpeechModelBundle, base: string): string {
  return join(base, "speech-models", modelFolderName(bundle));
}

/** The note that says which build was checked. */
function markerPath(dir: string): string {
  return join(dir, "verified.json");
}

type Marker = { version: string; files: Record<string, string> };

function readMarker(dir: string): Marker {
  try {
    const raw = readFileSync(markerPath(dir), "utf8");
    const parsed = JSON.parse(raw) as Marker;
    if (!parsed || typeof parsed.version !== "string")
      return { version: "", files: {} };
    return { version: parsed.version, files: parsed.files ?? {} };
  } catch {
    return { version: "", files: {} };
  }
}

function writeMarker(dir: string, marker: Marker): void {
  try {
    writeFileSync(markerPath(dir), JSON.stringify(marker), "utf8");
  } catch {
    // A note that cannot be written only costs a re-check later.
  }
}

/** What we know about the model on this computer. */
export function installedFiles(
  bundle: SpeechModelBundle,
  base: string,
): InstalledFile[] {
  const dir = modelDir(bundle, base);
  const marker = readMarker(dir);
  return bundle.files.map((f) => {
    const path = join(dir, f.name);
    const present = existsSync(path);
    return {
      name: f.name,
      present,
      sizeBytes: present ? statSync(path).size : 0,
      verifiedVersion:
        marker.version === bundle.version && marker.files[f.name] === f.sha256
          ? bundle.version
          : null,
    };
  });
}

/** Whether the model is installed and checked. */
export function modelInstalled(
  bundle: SpeechModelBundle,
  base: string,
): boolean {
  const files = installedFiles(bundle, base);
  return bundle.files.every((f) => {
    const found = files.find((x) => x.name === f.name);
    return found ? fileState(bundle, found) === 'ready' : false;
  });
}

/** Hash a file a piece at a time, so 650 MB does not need to be held in memory. */
async function hashFile(path: string): Promise<string> {
  const hasher = new Sha256();
  const stream = createReadStream(path, { highWaterMark: 4 * 1024 * 1024 });
  for await (const chunk of stream) {
    hasher.update(chunk as Buffer);
  }
  return hasher.digest();
}

/**
 * Fetch a file to disk, counting the bytes as they arrive.
 *
 * The fetch follows redirects, which is what a model host needs to reach its file store.
 * The signal stops it.
 */
async function download(
  url: string,
  destination: string,
  onBytes: (written: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetch(url, { redirect: "follow", signal });
  if (!response.ok || !response.body)
    throw new Error(`The download failed (${response.status}).`);
  const total = Number(response.headers.get("content-length") ?? 0);

  let written = 0;
  const counter = new Transform({
    transform(chunk: Buffer, _encoding, done) {
      written += chunk.length;
      onBytes(written);
      done(null, chunk);
    },
  });

  await pipeline(
    Readable.fromWeb(response.body as never),
    counter,
    createWriteStream(destination),
    signal ? { signal } : {},
  );

  // A short download is caught by the size check later, but say it here too.
  if (total && written !== total)
    throw new Error(`The download stopped early (${written} of ${total} bytes).`);
}

/**
 * Download the model and check it.
 *
 * The download can be stopped with the signal and its progress is reported. Each file is
 * fetched to a temporary name and only moved into place once it has been checked, so a
 * half-finished file is never mistaken for a good one.
 */
export async function installModel(
  bundle: SpeechModelBundle,
  base: string,
  options: InstallOptions = {},
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const dir = modelDir(bundle, base);
  mkdirSync(dir, { recursive: true });

  const marker = readMarker(dir);
  const next: Marker = { version: bundle.version, files: { ...marker.files } };
  const writtenByFile: Record<string, number> = {};

  for (const file of bundle.files) {
    const path = join(dir, file.name);
    const part = `${path}.part`;

    // A file left by an earlier attempt would make the download look done.
    if (existsSync(part)) rmSync(part, { force: true });

    // A file that is already there and was checked does not need fetching again.
    const already = installedFiles(bundle, base).find(
      (f) => f.name === file.name,
    );
    if (already && fileState(bundle, already) === "ready") {
      writtenByFile[file.name] = file.sizeBytes;
      options.onProgress?.({
        percent: bundleProgressPercent(bundle, writtenByFile),
        file: file.name,
        stage: "done",
      });
      continue;
    }

    try {
      await download(
        file.url,
        part,
        (written) => {
          writtenByFile[file.name] = written;
          options.onProgress?.({
            percent: bundleProgressPercent(bundle, writtenByFile),
            file: file.name,
            stage: "downloading",
          });
        },
        options.signal,
      );
    } catch (e) {
      if (existsSync(part)) rmSync(part, { force: true });
      const message =
        options.signal?.aborted
          ? "The download was stopped."
          : (e as Error).message || "The download failed.";
      return { ok: false, reason: message };
    }

    options.onProgress?.({
      percent: bundleProgressPercent(bundle, writtenByFile),
      file: file.name,
      stage: "verifying",
    });

    let digest: string;
    try {
      digest = await hashFile(part);
    } catch (e) {
      if (existsSync(part)) rmSync(part, { force: true });
      return {
        ok: false,
        reason: `The downloaded file could not be read: ${(e as Error).message}`,
      };
    }

    const result = verifySpeechFile(
      bundle,
      file.name,
      digest,
      statSync(part).size,
    );
    if (!result.ok) {
      // The file is not what we published, so it is thrown away rather than used.
      rmSync(part, { force: true });
      delete next.files[file.name];
      writeMarker(dir, next);
      return { ok: false, reason: result.reason };
    }

    // Only now does the file go into place.
    if (existsSync(path)) rmSync(path, { force: true });
    renameSync(part, path);
    next.files[file.name] = file.sha256;
    writeMarker(dir, next);
  }

  options.onProgress?.({ percent: 100, file: "", stage: "done" });
  return { ok: true };
}

/** Remove the model and the note that says it was checked. */
export function removeModel(bundle: SpeechModelBundle, base: string): void {
  const dir = modelDir(bundle, base);
  rmSync(dir, { recursive: true, force: true });
}

/**
 * Look after the model after the app was closed mid-install.
 *
 * A download that was interrupted leaves a `.part` file, which is never mistaken for a
 * good model. This removes it so the next attempt starts clean, and says whether
 * anything needs doing.
 */
export function recoverModelInstall(
  bundle: SpeechModelBundle,
  base: string,
): { needsAttention: boolean; reason?: string } {
  const dir = modelDir(bundle, base);
  if (!existsSync(dir)) return { needsAttention: false };

  let removedPartial = false;
  for (const file of bundle.files) {
    const part = join(dir, `${file.name}.part`);
    if (existsSync(part)) {
      rmSync(part, { force: true });
      removedPartial = true;
    }
  }

  if (removedPartial) {
    // The note about the check cannot be trusted after an interrupted install.
    const marker = readMarker(dir);
    if (marker.version) writeMarker(dir, { version: "", files: {} });
    return {
      needsAttention: true,
      reason: "The speech model did not finish downloading. Download it again.",
    };
  }
  return { needsAttention: false };
}
