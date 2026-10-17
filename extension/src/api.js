// Calls to the Murmur `ingest` function with the device token (upload-only).
import { SUPABASE_ANON_KEY, SUPABASE_URL } from './config.js';

const fn = (path) => `${SUPABASE_URL.replace(/\/$/, '')}/functions/v1/ingest/${path}`;

export async function call(path, body, token) {
  const res = await fetch(fn(path), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token ?? SUPABASE_ANON_KEY}` },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) {
    const err = new Error(data.error || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

/** Upload one part: ask for a signed URL, PUT the file, retrying a few times on network errors. */
export async function uploadPart(token, recordingId, idx, blob) {
  let lastErr;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const { url, content_type } = await call('upload-url', { recording_id: recordingId, idx, content_type: blob.type }, token);
      const put = await fetch(url, { method: 'PUT', headers: { 'Content-Type': content_type, 'x-upsert': 'true' }, body: blob });
      if (!put.ok) throw new Error(`Upload failed (${put.status})`);
      return;
    } catch (e) {
      lastErr = e;
      if (e.status && e.status < 500) throw e;
      await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt));
    }
  }
  throw lastErr;
}
