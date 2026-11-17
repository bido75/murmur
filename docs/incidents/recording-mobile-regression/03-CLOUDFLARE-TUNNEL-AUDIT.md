# Cloudflare Tunnel audit (browser-visible evidence)

## Final response headers seen by the browser (2026-10-30, before → after fix)

| Header | Before (regression) | After (fix live) |
|---|---|---|
| permissions-policy | `camera=(), microphone=(), geolocation=(self), payment=()` | `camera=(), microphone=(self), geolocation=(self), payment=()` |
| strict-transport-security | `max-age=31536000; includeSubDomains` | unchanged |
| x-content-type-options | `nosniff` | unchanged |
| x-frame-options | `DENY` | unchanged |
| referrer-policy | `strict-origin-when-cross-origin` | unchanged |
| CSP | report-only, `frame-ancestors 'none'` | unchanged |

## Checklist results

- Final page is HTTPS; `isSecureContext` true (same-origin app on `https://notes.giscop.com`). ✓
- No iframe embedding: app served top-level; `frame-ancestors 'none'` + `X-Frame-Options: DENY` mean no cross-origin embedding ever applies to our own top-level page. ✓
- No origin-changing redirects observed (SPA fallback serves same origin). ✓
- Origin of the bad header: `scripts/serve-web-dist.cjs:108` (our server), **not** Cloudflare (no Transform Rules/Workers in the zone; cf-cache-status DYNAMIC shows passthrough). ✓
- Scope of the fix: one directive changed; nothing globally weakened; camera/payment remain denied; HSTS/nosniff/frame/Referrer unchanged; CSP unchanged. ✓
