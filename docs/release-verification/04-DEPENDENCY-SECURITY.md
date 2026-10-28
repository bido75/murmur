# 04 — Dependency security

Status: **VERIFIED** (scans executed 2026-10-28); machine-readable findings in
`dependency-findings.json` in this folder.

## Scans run (exact commands)

| Surface | Command | Before | After |
|---|---|---|---|
| App (root) | `npm audit --json --omit=dev` | 9 (4 high, 5 low) | 8 (3 high, 5 low) |
| Desktop | `npm audit --json` | 3 dev (2 high, 1 moderate) | **0** |
| Zapier | `npm audit --json --omit=dev` | 2 high | **0** |
| Functions | `deno audit` (Deno 2.9.7 + deno.lock) | 2 high | 2 high — **mitigated at application layer** |

## Fixed this sprint

| Package | Was | Now | How |
|---|---|---|---|
| node-forge (root, high) | 1.4.0 | 1.4.2 | `npm audit fix` (semver-compatible) |
| electron (desktop, high) | 44.9.0 | 44.10.0 | `npm audit fix` |
| undici (desktop, high) | <7.30.1 | 7.30.1 | same |
| fast-uri (desktop, moderate) | <3.1.9 | 3.1.9 | same |
| zapier-platform-core (high) | 19.1.0 | 19.2.1 | minor bump |
| form-data (high) | 4.0.5 | ^4.0.6 | `overrides` in zapier/package.json (avoids the major downgrade npm suggested) |

All suites re-run green after the changes (tsc, 192+32+92 tests, desktop 92).

## Risk-accepted (documented, not hand-waved)

| Finding | Why no fix | Reachability |
|---|---|---|
| zod <4.6.6 (high) | fix is zod 4 (major); @expo/cli + eslint-plugin-react-hooks declare zod ^3; npm's proposed "fix" is downgrading Expo 58→51 (rejected) | **none** — build/lint-time schemas over developer-authored input only |
| deepmerge ≥4.2.0 ≤4.3.1 (low) | **no fixed version exists** (4.3.1 is latest; verified via `npm view deepmerge versions`) | **none** — @expo/config build-time merge of local config |
| @expo/cli cluster (high) | umbrella over the two above | **none** — CLI/build-time |

## Mitigated (application-layer fix)

`image-size` 1.2.1 (2 high advisories: ICNS/JXL/HEIF unbounded-loop parsers) —
unfixable upstream (even pptxgenjs@4.0.1 pins `image-size@^1.2.1`; Deno 2.9.7
overrides don't apply to transitive npm deps — both verified). **Reachability
was real**: `make-deck` embeds user photos from storage as data URIs, and
pptxgenjs runs them through image-size. Mitigation: `_shared/imageGuard.ts`
magic-byte allowlist (JPEG/PNG only) applied before embedding; non-conforming
photos are skipped and logged; 4 unit tests cover the vulnerable formats. The
vulnerable parsers can no longer receive attacker-controlled bytes. Residual
risk: image-size bugs in JPEG/PNG parsing itself.

## CI gate policy

The `security` job gates at **critical** severity (exit non-zero) and uploads
full audit JSONs as artifacts every run, so the accepted highs stay visible.
A high-severity gate would fail permanently on the accepted findings without a
fix path — critical-only is the honest enforceable line today.
