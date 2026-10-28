// Test kit for the recording-recovery integration tests. Not a test file.
//
// It provides process-local doubles for the platform edges the recovery and
// upload path touches (async storage, expo-file-system, the Supabase client,
// the native mic modules) so the REAL recorder.ts, sync.ts and recoveryFlow.ts
// run under fault injection. AsyncStorage is backed by a real file, so a
// second test process sees the state a restarted app would see.
//
// Supported faults (set before a flush):
//   kit.fail.upload = n   first n storage uploads fail (500)
//   kit.fail.invoke = n   first n edge-function invocations fail (500)
//   kit.session = null    the device has no signed-in user
import { mock } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";

export type Kit = {
  root: string;
  storageFile: string;
  fail: { upload: number; invoke: number };
  session: { user: { id: string }; access_token: string } | null;
  calls: { upload: string[]; invoke: string[]; upserts: string[]; updates: string[] };
  /** Every server call in order, e.g. "upload:audio/u/r/seg-0001", "invoke:process-recording". */
  log: string[];
  tables: Record<string, Map<string, Record<string, unknown>>>;
  resetFaults(): void;
};

export function makeKit(deviceName: string): Kit {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `murmur-rec-${deviceName}-`));
  const kit: Kit = {
    root,
    storageFile: path.join(root, "async-storage.json"),
    fail: { upload: 0, invoke: 0 },
    session: { user: { id: "user-1" }, access_token: "test-token" },
    calls: { upload: [], invoke: [], upserts: [], updates: [] },
    log: [],
    tables: {},
    resetFaults() {
      kit.fail.upload = 0;
      kit.fail.invoke = 0;
    },
  };
  return kit;
}

function loadStore(file: string): Record<string, string> {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return {};
  }
}

// ---------- async storage (file-backed, so a restart sees it) ----------
function installAsyncStorage(kit: Kit) {
  mock.module("@react-native-async-storage/async-storage", {
    defaultExport: {
      async getItem(k: string) {
        return loadStore(kit.storageFile)[k] ?? null;
      },
      async setItem(k: string, v: string) {
        const s = loadStore(kit.storageFile);
        s[k] = v;
        fs.writeFileSync(kit.storageFile, JSON.stringify(s));
      },
      async removeItem(k: string) {
        const s = loadStore(kit.storageFile);
        delete s[k];
        fs.writeFileSync(kit.storageFile, JSON.stringify(s));
      },
      async getAllKeys() {
        return Object.keys(loadStore(kit.storageFile));
      },
      async multiGet(keys: string[]) {
        const s = loadStore(kit.storageFile);
        return keys.map((k) => [k, s[k] ?? null]);
      },
      async multiRemove(keys: string[]) {
        const s = loadStore(kit.storageFile);
        for (const k of keys) delete s[k];
        fs.writeFileSync(kit.storageFile, JSON.stringify(s));
      },
    },
  });
}

// ---------- expo-file-system (real temp-dir semantics) ----------
function installFileSystem(kit: Kit) {
  const document = path.join(kit.root, "documents");
  fs.mkdirSync(document, { recursive: true });

  class FsFile {
    filePath: string;
    constructor(dirOrPath: unknown, name?: string) {
      if (typeof dirOrPath === "string") this.filePath = dirOrPath;
      else this.filePath = path.join((dirOrPath as { filePath: string }).filePath, name!);
    }
    get uri() {
      return this.filePath;
    }
    get exists() {
      return fs.existsSync(this.filePath);
    }
    get size() {
      return fs.statSync(this.filePath).size;
    }
    delete() {
      fs.unlinkSync(this.filePath);
    }
    moveSync(dest: FsFile) {
      fs.renameSync(this.filePath, dest.filePath);
    }
    async upload(_url: string, _opts: unknown) {
      kit.calls.upload.push(this.filePath);
      kit.log.push(`upload:${this.filePath}`);
      if (kit.fail.upload > 0) {
        kit.fail.upload -= 1;
        return { status: 500, body: "injected storage failure" };
      }
      return { status: 200, body: "{}" };
    }
  }
  class FsDirectory {
    filePath: string;
    constructor(parent: string | { filePath: string }, name?: string) {
      this.filePath =
        typeof parent === "string" ? path.join(parent, name ?? "") : path.join(parent.filePath, name ?? "");
    }
    get exists() {
      return fs.existsSync(this.filePath);
    }
    create(_opts?: unknown) {
      fs.mkdirSync(this.filePath, { recursive: true });
    }
  }
  mock.module("expo-file-system", {
    namedExports: {
      File: FsFile,
      Directory: FsDirectory,
      Paths: { document, cache: path.join(kit.root, "cache") },
      UploadType: { BINARY_CONTENT: "BINARY_CONTENT" },
      FileMode: { Read: "read" },
    },
  });
}

// ---------- supabase client (in-memory tables with real upsert semantics) ----------
function installSupabase(kit: Kit) {
  const key = (values: Record<string, unknown>, onConflict?: string) =>
    (onConflict ?? "id")
      .split(",")
      .map((c) => String(values[c.trim()]))
      .join("|");

  const table = (name: string) => {
    kit.tables[name] ??= new Map();
    return kit.tables[name];
  };

  const builder = (t: string) => ({
    upsert(values: Record<string, unknown>, opts?: { onConflict?: string; ignoreDuplicates?: boolean }) {
      kit.calls.upserts.push(`${t}:${key(values, opts?.onConflict)}`);
      kit.log.push(`upsert:${t}:${key(values, opts?.onConflict)}`);
      const m = table(t);
      const k = key(values, opts?.onConflict);
      if (!(opts?.ignoreDuplicates && m.has(k))) m.set(k, values);
      return Promise.resolve({ error: null });
    },
    update(values: Record<string, unknown>) {
      return {
        eq(_col: string, id: string) {
          kit.calls.updates.push(`${t}:${id}`);
          const m = table(t);
          const row = m.get(id);
          if (row) m.set(id, { ...row, ...values });
          return Promise.resolve({ error: null });
        },
      };
    },
    select(_cols?: string) {
      return {
        maybeSingle: () => Promise.resolve({ data: null }),
        eq() {
          return this;
        },
      };
    },
  });

  const supabase = {
    auth: {
      getSession: () => Promise.resolve({ data: { session: kit.session } }),
    },
    from: builder,
    storage: {
      from: (_bucket: string) => ({
        upload: (p: string) => {
          kit.calls.upload.push(`storage:${p}`);
          kit.log.push(`upload:storage:${p}`);
          if (kit.fail.upload > 0) {
            kit.fail.upload -= 1;
            return Promise.resolve({ error: { message: "injected storage failure" } });
          }
          return Promise.resolve({ error: null });
        },
        list: (folder: string) =>
          Promise.resolve({
            data: [...table("storage").keys()].filter((k) => k.startsWith(folder)).map((k) => ({ name: k.split("/").pop() })),
          }),
      }),
    },
    functions: {
      invoke: (name: string) => {
        kit.calls.invoke.push(name);
        kit.log.push(`invoke:${name}`);
        if (kit.fail.invoke > 0) {
          kit.fail.invoke -= 1;
          return Promise.resolve({ error: { message: "injected function failure" } });
        }
        return Promise.resolve({ data: { ok: true }, error: null });
      },
    },
  };
  mock.module("./supabase.ts", { namedExports: { supabase, isConfigured: true } });
}

// ---------- the native/browser modules recorder.ts and sync.ts touch ----------
// Relative specifiers are registered with an explicit .ts extension (Node can
// resolve those); extensionless imports inside the real modules are mapped to
// the same files by scripts/ts-extension-resolver.mjs, registered below.
export function installPlatformMocks(kit: Kit) {
  installAsyncStorage(kit);
  installFileSystem(kit);
  installSupabase(kit);
  mock.module("./dialog.ts", { namedExports: { isWeb: false, notify() {}, confirm: async () => true } });
  mock.module("./mic.ts", { namedExports: { requestMic: async () => undefined } });
  mock.module("./webStore.ts", {
    namedExports: { isIdbUri: () => false, keepBlob: async () => "", readBlob: async () => null, dropBlob: async () => undefined },
  });
  mock.module("./localStt.ts", {
    namedExports: {
      LOCAL_RECORDING: {},
      transcribeLocal: async () => [{ text: "recovered speech", startMs: 0, endMs: 1000 }],
    },
  });
  mock.module("./pcmRecorder.ts", {
    namedExports: {
      PcmWavRecorder: class {
        start() {}
        finishFile() {
          return 0;
        }
        pause() {}
        resume() {}
        release() {}
      },
      repairWav() {},
    },
  });
  mock.module("../../modules/murmur-foreground/index.ts", {
    namedExports: { startForegroundRecording() {}, stopForegroundRecording() {} },
  });
  mock.module("expo-audio", {
    namedExports: {
      RecordingPresets: { HIGH_QUALITY: {} },
      setAudioModeAsync: async () => undefined,
      useAudioRecorder: () => ({}),
      useAudioRecorderState: () => ({ durationMillis: 0 }),
    },
  });
  mock.module("expo-keep-awake", {
    namedExports: { activateKeepAwakeAsync: async () => undefined, deactivateKeepAwake() {} },
  });
  mock.module("react", {
    namedExports: {
      useRef: (v: unknown) => ({ current: v }),
      useState: (v: unknown) => [v, () => {}],
      useEffect: () => {},
      useCallback: (fn: unknown) => fn,
    },
  });
  mock.module("react-native", {
    namedExports: {
      AppState: { addEventListener: () => ({ remove() {} }) },
      Platform: { OS: "android", select: (o: Record<string, unknown>) => o.android ?? o.default },
    },
  });
  // Map the production modules' extensionless relative imports onto the same
  // files the explicit-extension mocks above are registered under.
  register(new URL("../../scripts/ts-extension-resolver.mjs", import.meta.url));
}

/** Write the session marker + a partial part exactly as the recorder does mid-recording. */
export function simulateCrashMidRecording(
  kit: Kit,
  opts: { recordingId: string; segIdx: number; doneMs: number; partBytes: number; local?: boolean },
) {
  const session = {
    recordingId: opts.recordingId,
    segIdx: opts.segIdx,
    doneMs: opts.doneMs,
    currentUri: path.join(kit.root, "cache", `rec-${opts.recordingId}-${opts.segIdx}.wav`),
    ...(opts.local ? { local: true } : {}),
  };
  fs.mkdirSync(path.dirname(session.currentUri), { recursive: true });
  // A WAV-looking partial: 44-byte header plus payload.
  fs.writeFileSync(session.currentUri, Buffer.alloc(44 + opts.partBytes, 7));
  const store = loadStore(kit.storageFile);
  store["recorder.active.v1"] = JSON.stringify(session);
  fs.writeFileSync(kit.storageFile, JSON.stringify(store));
  return session;
}

export async function importProductionModules() {
  const recorder = await import("./recorder.ts");
  const sync = await import("./sync.ts");
  const recoveryFlow = await import("./recoveryFlow.ts");
  return { ...recorder, ...sync, ...recoveryFlow };
}
