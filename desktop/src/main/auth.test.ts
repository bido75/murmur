import assert from "node:assert/strict";
import { get } from "node:http";
import test from "node:test";
import {
  LoopbackCapture,
  buildAuthorizeUrl,
  parseCallbackUrl,
} from "./auth.ts";

function getBody(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    get(url, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve(body));
    }).on("error", reject);
  });
}

test("authorize URL carries provider, redirect and PKCE method", () => {
  const url = new URL(
    buildAuthorizeUrl({
      supabaseUrl: "https://notes.example.com/",
      provider: "google",
      redirectTo: "http://127.0.0.1:0/auth/callback",
      codeChallenge: "abc123",
    }),
  );
  assert.equal(`${url.protocol}//${url.host}${url.pathname}`, "https://notes.example.com/auth/v1/authorize");
  assert.equal(url.searchParams.get("provider"), "google");
  assert.equal(url.searchParams.get("code_challenge"), "abc123");
  assert.equal(url.searchParams.get("code_challenge_method"), "s256");
});

test("callback with a code parses cleanly", () => {
  const r = parseCallbackUrl("http://127.0.0.1:51789/auth/callback?code=xyz&state=s1");
  assert.deepEqual(r, { ok: true, code: "xyz", state: "s1" });
});

test("murmur deep-link callback parses cleanly", () => {
  const r = parseCallbackUrl("murmur://auth/callback?code=xyz");
  assert.ok(r.ok);
  assert.equal((r as { code: string }).code, "xyz");
});

test("provider errors are surfaced, not swallowed", () => {
  const r = parseCallbackUrl("http://127.0.0.1:51789/auth/callback?error=access_denied&error_description=User%20cancelled");
  assert.deepEqual(r, { ok: false, reason: "provider-error", detail: "User cancelled" });
});

test("missing code and wrong host are rejected", () => {
  assert.equal(parseCallbackUrl("http://127.0.0.1:51789/auth/callback").ok, false);
  assert.equal(parseCallbackUrl("https://evil.example.com/auth/callback?code=x").ok, false);
  assert.equal(parseCallbackUrl("http://127.0.0.1:51789/other?code=x").ok, false);
  assert.equal(parseCallbackUrl("not a url").ok, false);
});

test("loopback listener captures the browser's code once", async () => {
  const capture = new LoopbackCapture();
  const port = await capture.start("state-1");
  try {
    assert.equal(capture.redirectUri, `http://127.0.0.1:${port}/auth/callback`);
    let delivered = "";
    capture.onNextCode((code) => (delivered = code));
    const body = await getBody(`${capture.redirectUri}?code=good-code&state=state-1`);
    assert.match(body, /close this window/i);
    assert.equal(delivered, "good-code");
    // A second hit is ignored, and a state mismatch never delivers.
    let again = "";
    capture.onNextCode((code) => (again = code));
    await getBody(`${capture.redirectUri}?code=second&state=state-1`);
    await getBody(`${capture.redirectUri}?code=sneaky&state=wrong-state`);
    assert.equal(again, "");
  } finally {
    capture.stop();
  }
});
