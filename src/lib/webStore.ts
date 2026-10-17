// Browser recordings are kept in IndexedDB until they upload, so closing or reloading the tab
// doesn't lose finished parts (blob URLs die with the page). Web only; no-ops elsewhere.
const DB = 'murmur-audio';
const STORE = 'parts';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const req = fn(t.objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

export const isIdbUri = (uri: string) => uri.startsWith('idb:');

/** Copy a blob URL into IndexedDB; returns an `idb:` reference for the upload queue. */
export async function keepBlob(blobUrl: string, key: string): Promise<string> {
  const blob = await (await fetch(blobUrl)).blob();
  await tx('readwrite', (s) => s.put(blob, key));
  return `idb:${key}`;
}

export async function readBlob(uri: string): Promise<Blob | null> {
  const v = await tx<Blob | undefined>('readonly', (s) => s.get(uri.slice(4)) as IDBRequest<Blob | undefined>);
  return v ?? null;
}

export async function dropBlob(uri: string): Promise<void> {
  await tx('readwrite', (s) => s.delete(uri.slice(4)));
}
