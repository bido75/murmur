#!/usr/bin/env node
// Serves the exported web app (dist-web) with an SPA fallback, so expo-router
// deep links work on any path. Built for the cloudflared tunnel: bind all
// interfaces so the connector can reach it via host.docker.internal.
//
//   node scripts/serve-web-dist.cjs [dir] [port]
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(process.argv[2] || "dist-web");
const PORT = Number(process.argv[3] || 8090);
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

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
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
  });
  fs.createReadStream(filePath).pipe(res);
});

server.on("error", (e) => { console.error(`serve-web-dist: ${e.message}`); process.exit(1); });
server.listen(PORT, "0.0.0.0", () => console.log(`web app on http://0.0.0.0:${PORT} (from ${ROOT}, SPA fallback on)`));
