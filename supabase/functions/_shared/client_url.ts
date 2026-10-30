// Rewrite a storage-signed URL so the app can reach it. Pure; tested under Node and Deno.

/**
 * Swap the host of a signed URL for the address the app actually uses.
 *
 * On a local stack the server sees itself as `http://kong:8000` — the Docker service
 * name — and storage-signed URLs come back with that host, which no phone or browser
 * can resolve. `externalBase` is the address the app really uses. The path and the
 * token are untouched, so the URL still opens. When `externalBase` is empty the URL is
 * returned unchanged.
 */
export function rewriteHost(url: string, externalBase: string): string {
  const base = (externalBase ?? '').trim().replace(/\/+$/, '');
  if (!base) return url;
  try {
    const u = new URL(url);
    const e = new URL(base);
    u.protocol = e.protocol;
    u.host = e.host;
    return u.toString();
  } catch {
    return url;
  }
}
