// Installing the speech model on the device: download it, check it, and know what state
// it is in afterwards.
//
// Nothing here trusts the download. The file is checked against the size and the checksum
// we published before it is used, and a download that was interrupted is never mistaken
// for a good one. The check is remembered, so the app does not re-hash 60 MB on every
// launch.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Directory, File, FileMode, Paths } from "expo-file-system";
import {
  DEFAULT_MODEL,
  modelFileName,
  modelState,
  modelUsable,
  progressPercent,
  verifyModelDigest,
  type ModelSpec,
  type ModelStatus,
} from "@/lib/shared";
import { Sha256 } from "@/lib/shared";

/** Where the check results are remembered. */
const VERIFIED_KEY = "stt.verified.v1";
/** The file the app used before versions were added. Still accepted, so nobody re-downloads 57 MB. */
const LEGACY_NAME = "ggml-base-q5_1.bin";

/** How a download is going. */
export type InstallProgress = {
  /** Whole percentage from 0 to 100. */
  percent: number;
  bytesWritten: number;
  totalBytes: number;
  /** What is happening now. */
  stage: "downloading" | "verifying" | "done";
};

export type InstallOptions = {
  /** Called as the download moves and while the file is being checked. */
  onProgress?: (p: InstallProgress) => void;
  /** Stops the download when it is aborted. */
  signal?: AbortSignal;
};

export type VerifiedRecord = {
  version: string;
  sizeBytes: number;
  sha256: string;
};

// The model the app installs by default, re-exported so callers have one place to look.
export { DEFAULT_MODEL, modelById, modelFileName } from "@/lib/shared";
export type { ModelSpec, ModelStatus } from "@/lib/shared";

async function readVerified(): Promise<Record<string, VerifiedRecord>> {
  try {
    const raw = await AsyncStorage.getItem(VERIFIED_KEY);
    return raw ? (JSON.parse(raw) as Record<string, VerifiedRecord>) : {};
  } catch {
    return {};
  }
}

async function writeVerified(
  id: string,
  record: VerifiedRecord,
): Promise<void> {
  try {
    const all = await readVerified();
    all[id] = record;
    await AsyncStorage.setItem(VERIFIED_KEY, JSON.stringify(all));
  } catch {
    // A note that cannot be written only costs a re-check later.
  }
}

async function forgetVerified(id: string): Promise<void> {
  try {
    const all = await readVerified();
    delete all[id];
    await AsyncStorage.setItem(VERIFIED_KEY, JSON.stringify(all));
  } catch {
    // Nothing to do.
  }
}

function modelsDir(): Directory {
  const dir = new Directory(Paths.document, "models");
  if (!dir.exists) dir.create({ intermediates: true });
  return dir;
}

/** The file the current model build is kept in. */
export function modelFile(spec: ModelSpec = DEFAULT_MODEL): File {
  return new File(modelsDir(), modelFileName(spec));
}

/**
 * The file the app used before versions were added, if it is still there.
 *
 * It is the same model, so somebody who downloaded it before versioning does not have to
 * fetch 60 MB again.
 */
export function legacyModelFile(): File {
  return new File(modelsDir(), LEGACY_NAME);
}

/** The file the model is actually in: the current one, or the older file if that is all there is. */
export function installedModelFile(spec: ModelSpec = DEFAULT_MODEL): File {
  const current = modelFile(spec);
  if (current.exists) return current;
  const legacy = legacyModelFile();
  return legacy.exists ? legacy : current;
}

/**
 * What state the model on this device is in.
 *
 * A model that was downloaded before versions existed is accepted when it matches the
 * checksum we publish, so nobody has to fetch it again.
 */
export async function modelStatus(
  spec: ModelSpec = DEFAULT_MODEL,
): Promise<ModelStatus> {
  const verified = await readVerified();
  const current = modelFile(spec);
  const legacy = legacyModelFile();

  if (current.exists) {
    return {
      spec,
      present: true,
      sizeBytes: current.size ?? 0,
      installedVersion: spec.version,
      verifiedVersion: verified[spec.id]?.version ?? null,
    };
  }

  if (legacy.exists) {
    return {
      spec,
      present: true,
      sizeBytes: legacy.size ?? 0,
      installedVersion: spec.version,
      verifiedVersion: verified[spec.id]?.version ?? null,
    };
  }

  return {
    spec,
    present: false,
    sizeBytes: 0,
    installedVersion: null,
    verifiedVersion: null,
  };
}

/** Whether the model on the device can be used right now. */
export async function modelUsableNow(
  spec: ModelSpec = DEFAULT_MODEL,
): Promise<{ usable: boolean; needsCheck: boolean; reason?: string }> {
  return modelUsable(await modelStatus(spec));
}

/**
 * Hash a file a piece at a time.
 *
 * The model is around 60 MB. Reading it all at once and hashing that copy needs about
 * 120 MB of memory, which is a lot to ask of a phone, so it is read in small pieces and
 * the hash is built as it goes.
 */
async function hashFile(file: File): Promise<string> {
  const hasher = new Sha256();
  const handle = await file.open(FileMode.ReadOnly);
  try {
    const chunk = 4 * 1024 * 1024;
    for (;;) {
      const bytes = await handle.readBytes(chunk);
      if (!bytes || bytes.length === 0) break;
      hasher.update(bytes);
      // A short read means the end of the file.
      if (bytes.length < chunk) break;
    }
  } finally {
    handle.close();
  }
  return hasher.digest();
}

/**
 * Check the model on the device against the checksum we published.
 *
 * A model that has already been checked is not checked again: the result is remembered,
 * so a 60 MB file is not re-hashed before every recording part. The check happens when
 * the model is installed, and again if the file changes size.
 */
export async function verifyInstalledModel(
  spec: ModelSpec = DEFAULT_MODEL,
): Promise<boolean> {
  const status = await modelStatus(spec);
  if (!status.present) return false;
  const file = installedModelFile(spec);
  if (!file.exists) return false;
  if (file.size !== spec.sizeBytes) return false;

  // Already checked this build of this file: nothing to do.
  const verified = await readVerified();
  const record = verified[spec.id];
  if (record && record.version === spec.version && record.sizeBytes === spec.sizeBytes)
    return true;

  let digest: string;
  try {
    digest = await hashFile(file);
  } catch {
    // The file could not be read, so it cannot be trusted.
    return false;
  }
  const result = verifyModelDigest(spec, digest, file.size);
  if (!result.ok) return false;

  await writeVerified(spec.id, {
    version: spec.version,
    sizeBytes: spec.sizeBytes,
    sha256: spec.sha256,
  });
  return true;
}

/**
 * Download the model, then check it.
 *
 * The download can be stopped with the signal and its progress is reported. A download
 * that was stopped or that fails leaves nothing behind that could be mistaken for a good
 * model: the partial file is removed.
 */
export async function installModel(
  spec: ModelSpec = DEFAULT_MODEL,
  options: InstallOptions = {},
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const dir = modelsDir();
  const destination = new File(dir, modelFileName(spec));

  options.onProgress?.({
    percent: 0,
    bytesWritten: 0,
    totalBytes: spec.sizeBytes,
    stage: "downloading",
  });

  // A file left by an earlier attempt would make the download look done.
  if (destination.exists) destination.delete();

  try {
    const task = File.createDownloadTask(spec.url, destination, {
      onProgress: ({ bytesWritten, totalBytes }) =>
        options.onProgress?.({
          percent: progressPercent(bytesWritten, totalBytes),
          bytesWritten,
          totalBytes,
          stage: "downloading",
        }),
      signal: options.signal,
    });
    const file = await task.downloadAsync();
    if (!file) {
      // The task was paused or cancelled; nothing usable was written.
      throw new Error("The download was stopped.");
    }
  } catch (e) {
    // Remove the partial file so the next attempt starts clean.
    if (destination.exists) destination.delete();
    const message =
      options.signal?.aborted
        ? "The download was stopped."
        : (e as Error).message || "The download failed.";
    return { ok: false, reason: message };
  }

  options.onProgress?.({
    percent: 100,
    bytesWritten: spec.sizeBytes,
    totalBytes: spec.sizeBytes,
    stage: "verifying",
  });

  let digest: string;
  try {
    digest = await hashFile(destination);
  } catch (e) {
    if (destination.exists) destination.delete();
    return {
      ok: false,
      reason: `The downloaded model could not be read: ${(e as Error).message}`,
    };
  }
  const result = verifyModelDigest(spec, digest, destination.size);
  if (!result.ok) {
    // The file is not what we published, so it is thrown away rather than used.
    if (destination.exists) destination.delete();
    await forgetVerified(spec.id);
    return { ok: false, reason: result.reason };
  }

  await writeVerified(spec.id, {
    version: spec.version,
    sizeBytes: spec.sizeBytes,
    sha256: spec.sha256,
  });

  options.onProgress?.({
    percent: 100,
    bytesWritten: spec.sizeBytes,
    totalBytes: spec.sizeBytes,
    stage: "done",
  });
  return { ok: true };
}

/** Remove the model and the note that says it was checked. */
export async function removeModel(
  spec: ModelSpec = DEFAULT_MODEL,
): Promise<void> {
  const current = modelFile(spec);
  if (current.exists) current.delete();
  const legacy = legacyModelFile();
  if (legacy.exists) legacy.delete();
  await forgetVerified(spec.id);
}

/**
 * Look after the model after the app was closed mid-install.
 *
 * A download that was interrupted leaves a file of the wrong size, which the model state
 * already reports as damaged; this makes sure the note about the check is not left
 * claiming a good file, and tells the caller whether anything needs doing.
 */
export async function recoverModelInstall(
  spec: ModelSpec = DEFAULT_MODEL,
): Promise<{ needsAttention: boolean; reason?: string }> {
  const status = await modelStatus(spec);
  const state = modelState(status);
  if (state === "missing") return { needsAttention: false };
  if (state === "corrupt") {
    // A half-finished download. Remove it so the next attempt is clean.
    const file = installedModelFile(spec);
    if (file.exists) file.delete();
    await forgetVerified(spec.id);
    return {
      needsAttention: true,
      reason: "The speech model did not finish downloading. Download it again.",
    };
  }
  return { needsAttention: false };
}
