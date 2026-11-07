# Deployment and git forensics

## Deployed version at incident time

- `notes.giscop.com` serves the local build from `C:\Users\vinny\Documents\murmur-ready\murmur\dist-web` via `scripts/serve-web-dist.cjs` (:8090) behind `cloudflared-notes`. The working tree on 2026-10-30 was `feature/murmur-desktop-v2` (the deploy source directory, not a checked-out release).
- Last known working recording: the 2026-10-29 release-verification pass, before commit `2065aac`'s headers reached the running server (headers are read live on every response — no rebuild needed).
- First failing deployment: the server restart after `2065aac` (headers take effect immediately on every response).

## Change-impact matrix

| Change (commit) | Touches recording? | Confirmed role |
|---|---|---|
| `2065aac` security headers | **Yes — `permissions-policy`** | **Root cause A** (confirmed: header visible live; removing/fixing restores) |
| Desktop V2 commits (`8ad8781`…`d3902d5`) | No — `desktop/**` only | Excluded: recording code lives in `src/lib` (mobile/web), untouched |
| Shared `src/lib` commits (quote-normalization set, uncommitted) | No behavioral change — string/quote normalization only, tests green | Excluded |
| Tunnel config changes | No — routing unchanged; login/200s continued | Excluded |
| Supabase config/functions changes | No — backend verified independently (192 Deno tests; upload/API 200s) | Excluded |

## Deployment-source check (question F)

The web bundle was rebuilt during the Oct 29 refresh from the remediation working tree; the regression is server-header-side, not bundle-side — the same bundle records fine once the header is corrected.
