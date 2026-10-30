// Desktop OAuth callback capture.
//
// The renderer drives Supabase's PKCE OAuth flow itself (signInWithOAuth with
// skipBrowserRedirect, then exchangeCodeForSession). This module only moves the
// browser's redirect back to the renderer, over two channels:
//
//  1. A loopback HTTP listener on 127.0.0.1 (primary: no OS registration needed).
//  2. The murmur:// deep link (registered with the OS; used when the browser is
//     opened before the listener, or when a loopback port is blocked).
//
// No tokens are exchanged here and no token logic is duplicated: the code handed to
// the renderer is useless without Supabase's stored PKCE verifier.
import { createServer, type Server } from "node:http";

export type OAuthProvider = "google" | "apple" | "azure" | "slack";

export type AuthorizeParams = {
  supabaseUrl: string;
  provider: OAuthProvider;
  redirectTo: string;
  codeChallenge: string;
};

/** The authorize entry point Supabase serves for the provider; PKCE is bound by supabase-js. */
export function buildAuthorizeUrl(p: AuthorizeParams): string {
  const base = `${p.supabaseUrl.replace(/\/$/, "")}/auth/v1/authorize`;
  const q = new URLSearchParams({
    provider: p.provider,
    redirect_to: p.redirectTo,
    code_challenge: p.codeChallenge,
    code_challenge_method: "s256",
  });
  return `${base}?${q.toString()}`;
}

export type CallbackResult =
  | { ok: true; code: string; state: string | null }
  | { ok: false; reason: "no-code" | "provider-error"; detail: string };

/**
 * Parse a redirect the browser landed on. Accepts the loopback path and the
 * murmur:// deep link. Provider errors are surfaced, never swallowed.
 */
export function parseCallbackUrl(raw: string): CallbackResult {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "no-code", detail: "The sign-in link was malformed." };
  }
  const isLoopback =
    (url.protocol === "http:" && ["127.0.0.1", "localhost"].includes(url.hostname)) ||
    url.protocol === "murmur:";
  // "murmur://auth/callback" parses with "auth" as the host; both spellings are ours.
  const path =
    url.protocol === "murmur:" && url.hostname === "auth"
      ? `/auth${url.pathname}`
      : url.pathname;
  if (!isLoopback || !path.startsWith("/auth/callback"))
    return {
      ok: false,
      reason: "no-code",
      detail: "The sign-in link did not come from Murmur's callback.",
    };
  const error = url.searchParams.get("error");
  if (error)
    return {
      ok: false,
      reason: "provider-error",
      detail: url.searchParams.get("error_description") ?? error,
    };
  const code = url.searchParams.get("code");
  if (!code) return { ok: false, reason: "no-code", detail: "The sign-in link had no code." };
  return { ok: true, code, state: url.searchParams.get("state") };
}

/**
 * One-use HTTP listener that catches the browser's redirect and reports the code.
 * The browser tab is answered with a page that says the sign-in can continue in the app.
 */
export class LoopbackCapture {
  private server: Server | null = null;
  private expectedState: string | null = null;
  private settled = false;

  /** The redirect URI to give the provider, known only after start(). */
  redirectUri = "";

  start(expectedState: string | null): Promise<number> {
    return new Promise((resolve, reject) => {
      this.expectedState = expectedState;
      this.server = createServer((req, res) => {
        const respond = (body: string) => {
          res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
          res.end(
            `<!doctype html><meta charset="utf-8"><title>Murmur</title><p>${body}</p>`,
          );
        };
        try {
          const raw = `http://127.0.0.1${req.url ?? "/"}`;
          const parsed = parseCallbackUrl(raw);
          if (this.expectedState && parsed.ok && parsed.state !== this.expectedState) {
            respond("This sign-in link does not match the request that started it. Close this window and try again.");
            return;
          }
          if (!parsed.ok) {
            respond(`Sign-in could not finish: ${parsed.detail}`);
            return;
          }
          this.deliver(parsed.code);
          respond("Signed in. You can close this window and return to Murmur.");
        } catch {
          respond("Something went wrong reading the sign-in link.");
        } finally {
          // One code is enough; keep serving the friendly page but stop delivering.
          this.settled = true;
        }
      });
      this.server.on("error", reject);
      // Port 0 lets the OS pick a free port, so parallel app instances do not clash.
      this.server.listen(0, "127.0.0.1", () => {
        const addr = this.server?.address();
        if (!addr || typeof addr === "string") return reject(new Error("No loopback port"));
        this.redirectUri = `http://127.0.0.1:${addr.port}/auth/callback`;
        resolve(addr.port);
      });
    });
  }

  private deliver: (code: string) => void = () => {};

  /** Resolve when the code arrives; a second code is ignored. */
  onNextCode(fn: (code: string) => void): void {
    this.deliver = (code) => {
      if (this.settled) return;
      fn(code);
    };
  }

  stop(): void {
    this.server?.close();
    this.server = null;
  }
}
