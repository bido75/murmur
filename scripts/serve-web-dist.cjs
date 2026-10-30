#!/usr/bin/env node
// Serves the exported web app (dist-web) with an SPA fallback, so expo-router
// deep links work on any path. Built for the cloudflared tunnel: bind all
// interfaces so the connector can reach it via host.docker.internal.
//
// It also reverse-proxies the MCP + OAuth endpoints onto the web app's domain,
// which is what MCP connectors (Claude.ai, ChatGPT) expect: one origin for the
// MCP endpoint, the OAuth discovery documents, registration and token exchange
// (the same map scripts/hosting-config.mjs writes for Vercel). The consent page
// /oauth/authorize stays in the app itself.
//
//   node scripts/serve-web-dist.cjs [dir] [port]
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(process.argv[2] || "dist-web");
const PORT = Number(process.argv[3] || 8090);
const KONG = process.env.KONG_ORIGIN || "http://127.0.0.1:54321";
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".map": "application/json",
  ".webp": "image/webp",
  ".txt": "text/plain",
};

/** Web-domain path -> Supabase edge path (exactly the hosting-config map). */
const PROXIES = [
  ["/.well-known/oauth-authorization-server", "/functions/v1/oauth/.well-known/oauth-authorization-server"],
  ["/.well-known/oauth-protected-resource/mcp", "/functions/v1/mcp/.well-known/oauth-protected-resource"],
  ["/.well-known/oauth-protected-resource", "/functions/v1/mcp/.well-known/oauth-protected-resource"],
  ["/mcp", "/functions/v1/mcp"],
  ["/oauth/token", "/functions/v1/oauth/token"],
  ["/oauth/register", "/functions/v1/oauth/register"],
  ["/oauth/revoke", "/functions/v1/oauth/revoke"],
];

function proxyTarget(urlPath) {
  for (const [from, to] of PROXIES) {
    if (urlPath === from || urlPath === `${from}/`) return to;
  }
  return null;
}

// The proxy reads the whole request body first (JSON-RPC bodies are small),
// which avoids Node's streaming duplex pitfalls entirely.
function proxy(req, res, target) {
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", async () => {
    try {
      const headers = { ...req.headers };
      delete headers.host;
      delete headers.connection;
      const body = chunks.length ? Buffer.concat(chunks) : undefined;
      const up = await fetch(target, {
        method: req.method,
        headers,
        body,
      });
      const out = {};
      up.headers.forEach((v, k) => {
        if (!["content-encoding", "transfer-encoding", "connection", "content-length"].includes(k)) out[k] = v;
      });
      const buf = Buffer.from(await up.arrayBuffer());
      out["content-length"] = String(buf.length);
      res.writeHead(up.status, out);
      res.end(buf);
    } catch (e) {
      res.writeHead(502, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: `The API server did not answer: ${(e || {}).message}` }));
    }
  });
}

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
  const target = proxyTarget(urlPath);
  if (target) return proxy(req, res, `${KONG}${target}${req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : ""}`);
  let filePath = path.join(ROOT, path.normalize(urlPath).replace(/^([/\\])+/, ""));
  if (!filePath.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    // SPA fallback: unknown paths render the app and route client-side.
    filePath = path.join(ROOT, "index.html");
  }
  const ext = path.extname(filePath).toLowerCase();
  // Hashed build assets may cache forever; the HTML that names them must not,
  // or browsers keep loading a stale bundle from a previous deployment.
  const immutable = filePath.includes(`${path.sep}_expo${path.sep}static${path.sep}`);
  res.writeHead(200, {
    "content-type": MIME[ext] || "application/octet-stream",
    "cache-control": immutable ? "public, max-age=31536000, immutable" : "no-cache",
    // Security headers (found missing by the 2026-10-29 whitehat pass).
    "strict-transport-security": "max-age=31536000; includeSubDomains",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "strict-origin-when-cross-origin",
    "permissions-policy": "camera=(), microphone=(), geolocation=(self), payment=()",
    // Report-only until the app's inline/style sources are audited, then enforce.
    "content-security-policy-report-only":
      "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' https://*.supabase.co https://api.openai.com https://api.anthropic.com https://openrouter.ai https://api.deepgram.com; frame-ancestors 'none'; report-uri /csp-report",
  });
  fs.createReadStream(filePath).pipe(res);
});

server.on("error", (e) => { console.error(`serve-web-dist: ${e.message}`); process.exit(1); });
server.listen(PORT, "0.0.0.0", () => console.log(`web app on http://0.0.0.0:${PORT} (from ${ROOT}, SPA fallback on, MCP/OAuth proxied to ${KONG})`));
