// Working out where the server is, from the browser's point of view.
//
// The address of the Supabase server is set when the app is built, so for a server on
// the same computer it says "127.0.0.1". But the app may be open on *another* computer
// on the network, and there "127.0.0.1" means that other computer, where there is no
// server. That is why logging in from another machine failed with "fetch failed".
//
// So when the address points at this computer, the name of the computer the app was
// served from is used instead. The server is always on the same computer as the app
// talking to it, so that name is the right one. A server that is genuinely somewhere
// else is left exactly as it was configured.
//
// Pure, so it can be tested.

/** The addresses that mean "this computer". */
const THIS_COMPUTER = ["127.0.0.1", "localhost", "::1", "0.0.0.0"];

/**
 * The address of the server, for the machine the app is running on.
 *
 * `pageHost` is the name the app was served from, or null when there is none — on a
 * phone, and on a page opened from a file.
 */
export function resolveSupabaseUrl(
  configured: string,
  pageHost: string | null,
): string {
  if (!configured || !pageHost) return configured;
  let parsed: URL;
  try {
    parsed = new URL(configured);
  } catch {
    return configured;
  }
  if (!THIS_COMPUTER.includes(parsed.hostname)) return configured;
  // "localhost" means the same thing either way, and a page served from a file has no
  // name to use.
  if (!pageHost || pageHost === "localhost") return configured;
  parsed.hostname = pageHost;
  return parsed.toString().replace(/\/$/, "");
}
