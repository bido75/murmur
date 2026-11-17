// The OS-protected store for a signed-in session's tokens.
//
// Supabase sessions contain a refresh token. Leaving it in the renderer's
// localStorage would be a plain-text file on disk, readable by anything with the
// user's account. This store encrypts with Electron's safeStorage - DPAPI on
// Windows, the Keychain on macOS, libsecret on Linux - and keeps the ciphertext in
// one file. When the OS mechanism is unavailable, entries are stored in the clear
// and flagged as such, so a fallback is visible rather than silent.
import { safeStorage } from "electron";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import {
  parseStore,
  secureStorePath,
  serializeStore,
  storeMode,
  type Store,
} from "../shared/secureStoreCore.ts";

function readStore(dir: string): Store {
  const file = secureStorePath(dir);
  if (!existsSync(file)) return {};
  try {
    return parseStore(readFileSync(file, "utf8"));
  } catch {
    return {};
  }
}

function writeStore(dir: string, store: Store): void {
  const file = secureStorePath(dir);
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, serializeStore(store));
  renameSync(tmp, file);
}

export function secureGet(dir: string, key: string): string | null {
  const entry = readStore(dir)[key];
  if (!entry) return null;
  if (entry.plain) return entry.data;
  try {
    return safeStorage.decryptString(Buffer.from(entry.data, "base64"));
  } catch {
    // A ciphertext the OS can no longer open (new machine user, rotated key) is a
    // miss, not an error: the user signs in again.
    return null;
  }
}

export function secureSet(dir: string, key: string, value: string): void {
  const store = readStore(dir);
  if (storeMode(safeStorage.isEncryptionAvailable()) === "os") {
    store[key] = { plain: false, data: safeStorage.encryptString(value).toString("base64") };
  } else {
    store[key] = { plain: true, data: value };
  }
  writeStore(dir, store);
}

export function secureRemove(dir: string, key: string): void {
  const store = readStore(dir);
  if (key in store) {
    delete store[key];
    writeStore(dir, store);
  }
}
