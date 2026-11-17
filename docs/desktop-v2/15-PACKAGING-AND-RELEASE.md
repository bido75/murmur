# Packaging and release (Desktop V2, Phase 5)

Status as of 2026-10-29. Traced to `desktop/electron-builder.yml`, `desktop/build.mjs`,
`desktop/package.json`.

## Current packaging state

| Aspect | Status | Notes |
|---|---|---|
| Bundling | READY — esbuild bundles main/preloads (CJS, node22) and renderer (IIFE, chrome140); native `onnxruntime-node` and `electron` stay external and are packaged from node_modules | `build.mjs` |
| Renderer assets | READY — index/overlay/floating HTML, styles, worklet copied to `dist/renderer` | `build.mjs` |
| asar | READY (default) — electron-builder's smart unpack keeps `.node` binaries loadable; no manual asarUnpack needed | `electron-builder.yml` (default) |
| Windows target | CONFIGURED — NSIS, per-user install, `dist:win` script; unsigned (no certificate available in this environment) | `electron-builder.yml` |
| macOS target | CONFIGURED — dmg+zip, hardened runtime, entitlements (mic + screen capture usage strings), SystemAudioCapture helper as extra resource; notarization requires Apple ID credentials | `build/entitlements.mac.plist` |
| Linux target | DEFERRED by operator decision (D-20) | — |
| App ID | BLOCKED ON OPERATOR — `com.example.murmur.desktop` is a placeholder; a real reverse-DNS id must be confirmed before any store/notarized build because it is immutable after distribution | D-03 |
| Windows signing | BLOCKED — needs a certificate; plumbing (nsis config) is in place | D-17 |
| macOS notarization | BLOCKED — needs Apple Developer credentials | D-18 |
| Auto-update | BLOCKED-PREPARED — strategy: electron-updater with a pinned, HTTPS, signed feed; enable only after signing/notarization works end-to-end. Not wired yet by design (D-19) | master prompt §27 |
| CI lane | READY — `desktop-ci` builds and tests on windows-latest + macos-latest and uploads `dist` artifacts; installer packaging is intentionally not in CI until signing exists | `.github/workflows/desktop.yml` |

## Release gates for the desktop distribution

1. Real app id confirmed and set (D-03).
2. Windows code signing certificate + macOS notarization credentials supplied by the
   operator (D-17, D-18) — unsigned installers must never be distributed.
3. AGPL review sign-off (BL-LEGAL) — the Parakeet weights are CC BY 4.0 with attribution
   shipped; no Murmure source is used.
4. A signed-in live run on real hardware: record → stop → recover → transcribe → notes
   (acceptance criteria §31 items 1–5, 14).
5. Installer launch verified on each claimed OS.

## What is deliberately not claimed

- No installer has been executed on a clean machine in this environment; `dist:win`
  output is reproducible but unverified as an installed product.
- No auto-update binary feed exists; the update story above is the plan, not a
  working mechanism.
