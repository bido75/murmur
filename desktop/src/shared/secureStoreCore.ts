// Pure core of the OS-protected store: shapes and decisions, no Electron import,
// so it can be unit-tested with node:test.

export type Entry = { plain: boolean; data: string };
export type Store = Record<string, Entry>;

/** Which mode new writes use. Pure so the decision can be tested. */
export function storeMode(encryptionAvailable: boolean): "os" | "plain" {
  return encryptionAvailable ? "os" : "plain";
}

export function parseStore(raw: string | null): Store {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
      return {};
    return parsed as Store;
  } catch {
    return {};
  }
}

/** The store as JSON text; kept atomic at the file level. */
export function serializeStore(store: Store): string {
  return JSON.stringify(store);
}

export function secureStorePath(dir: string): string {
  return `${dir}/secure-store.json`;
}
