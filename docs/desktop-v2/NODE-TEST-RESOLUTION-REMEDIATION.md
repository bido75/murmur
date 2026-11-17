# `node:test` dependency-resolution remediation

Date: 2026-10-30 · Branch `feature/murmur-desktop-v2` · Status: **root cause identified; repo-side boundaries verified and hardened; the failing environment is external to the repo**

## 1. The exact error, fingerprinted

```
Could not find dependency: 'node:test' relative to '/desktop/src/shared/meetings.test.ts'
```

Fingerprint analysis:

- **Not a repo-side tool.** A string search across `desktop/node_modules` and
  `zapier/node_modules` (esbuild, zapier-platform-core, electron-builder, tsc,
  electron) finds **zero** occurrences of the phrase "Could not find dependency".
  Each of those tools has its own distinct phrasing (esbuild: `Could not resolve`;
  webpack: `Module not found`; node ESM: `Cannot find module`).
- **Leading-slash paths** (`/desktop/src/...`) are workspace-root-relative paths used
  by sandboxed web dev environments that mount the project at `/`.
- **Cross-cutting scope**: the same error appears for three trees that share no build
  system at all — the Electron desktop bundle (esbuild), Supabase Edge Functions
  (Deno), and the Zapier app (plain Node). No single repo build could scan all three.
- **The targets are all test files** that no production entry point imports.

Conclusion: the error comes from a **web-based development environment's own
dependency analyzer** (WebContainer-class sandbox — e.g. StackBlitz/bolt-style
"Vibe Coder" tooling). Its resolver does not implement Node's built-in `node:test`
module and it statically analyzes the whole mounted workspace, including test files
that no build ever bundles. This matches the known limitation: WebContainer-style
Node shims support a subset of Node built-ins and do not provide `node:test`.

## 2. Ground truth in the real toolchain (all executed 2026-10-30)

| Runtime | Version | `node:test` | Result |
|---|---|---|---|
| Node (desktop/zapier) | v24.14.1 | `import('node:test')` succeeds | Desktop **160 pass / 0 fail**; Zapier **2 pass / 0 fail** |
| Deno (Edge Functions) | 2.9.7 | Node-compat supports `node:test` | **192 pass / 0 failed** (`deno test --allow-all _shared/`) |
| Electron | 44.10.0 | n/a — never imports tests | bundles contain zero `node:test` strings |

## 3. Build boundaries — verified, then hardened

| Check | Method | Result |
|---|---|---|
| Renderer bundles contain no tests | grep `dist/` for `node:test` and `*.test.*` files | 0 occurrences, 0 files |
| Production code never imports tests | grep all non-`*.test.ts` sources for `.test.` imports | 0 |
| Bundler cannot glob tests in | `build.mjs` uses explicit entry points (`main.ts`, `preload.ts`, `overlayPreload.ts`, `floatingPreload.ts`, `app.ts`) — no glob patterns | verified by construction |
| Installers contain no test code | `npx asar list` on the packaged app | 4 vendored `global-agent` dist test files found → **fixed**: excluded via `files` filter → **0 test files in the asar** (fresh build verified) |
| Supabase production functions | `deno check supabase/functions` passes; tests live in `_shared/*.test.ts`, imported by nothing at runtime | pass |
| Zapier runtime | `zapier/test/app.test.js` is referenced only by the `npm test` script (`node --test`), never by `index.js` | verified |

## 4. Reproduction steps

1. In any real runtime: `node -e "import('node:test').then(() => console.log('ok'))"` → ok.
2. `cd desktop && node build.mjs && npm test` → build clean, 160/0.
3. `deno test --allow-all supabase/functions/_shared/` → 192/0.
4. `cd zapier && npm test` → 2/0.
5. Only inside the web-based environment do the 19 "Could not find dependency"
   messages appear — none during any repo command.

## 5. The fix — and where it belongs

**The repo's code and build configuration are correct and were not rewritten.** Per
the remediation rules, no fake `node:test` package was installed, no valid imports
were changed, and no tests were removed.

The fix belongs in the reporting environment's configuration:

- Exclude test files from its static dependency analysis:
  `**/*.test.ts`, `**/*.test.js`, `zapier/test/**`, `supabase/functions/_shared/*.test.ts`,
  `desktop/src/**/*.test.ts`.
- Its Node shim does not provide `node:test`; its analyzer should treat
  `node:*` specifiers as externals (Node built-ins), not workspace dependencies.
- The environment should either run tests with its own supported runtime or surface
  them read-only (source view) instead of resolving them as app modules.

**Limitation honestly stated**: the repository cannot modify a third-party IDE's
resolver. If the Vibe Coder environment cannot be configured to exclude test globs,
those 19 messages will remain visible in that environment while every actual build,
test and packaging pipeline stays green. That is an analyzer limitation, not an
application defect — and per the acceptance rules it is documented here rather than
reported as "fixed in the environment".

## 6. Regression validation (after the one repo-side change)

| Command | Result |
|---|---|
| `npm run typecheck` (desktop) | clean |
| `npm test` (desktop) | **160 pass / 0 fail** / 2 skipped |
| `node build.mjs` | clean |
| `npx electron-builder --win --x64` | fresh installer, asar re-listed: **0 test files** |
| `deno check .` / `deno test --allow-all _shared/` (supabase) | pass / **192 pass** |
| `npm test` (zapier) | **2 pass / 0 fail** |
| Security posture | unchanged: contextIsolation/sandbox/IPC validation untouched; no Node APIs added to the renderer |

## 7. Files changed by this remediation

- `desktop/electron-builder.yml` — `files` exclusions for vendored
  `global-agent` test files (win + mac blocks). This closes the only real
  "tests inside an installer" finding; it was never related to the reported errors.

## 8. Open question — closed

The operator confirmed on 2026-10-30 that the errors appeared while testing the app
in **githubox**, a web-based GitHub repository viewer/analysis environment. This
matches every element of the fingerprint in §1: a browser-side analyzer that mounts
the repo at `/`, sweeps the whole workspace (including test files no build imports),
and resolves imports with a Node shim that does not provide `node:test`.

Final classification: **environment limitation of githubox's analyzer**, not an
application or build defect. No repo change is required beyond the installer test-file
exclusion already applied (§7). Practical guidance when using githubox for Murmur:

- Treat its dependency warnings for `*.test.*` files as analyzer noise; the supported
  verification commands are the ones in §2/§6 (Node `npm test`, `deno test`, Zapier
  `npm test`, `electron-builder`).
- Do not modify imports or install shim packages to satisfy it.
- Any future code review should still prefer the repo's own CI (real runtimes) as the
  source of truth over a sandbox analyzer's resolver errors.
