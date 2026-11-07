# Deployment and rollback plan

## What was deployed (and why it could be done immediately)

The tunnel's origin is the local server process (`node scripts/serve-web-dist.cjs` on
:8090). The P0 fix required restarting that process — the same restart any code change
to it would need. Done 2026-10-30, verified browser-visible through Cloudflare:

- Before: `permissions-policy: camera=(), microphone=(), geolocation=(self), payment=()`
- After: `permissions-policy: camera=(), microphone=(self), geolocation=(self), payment=()`

Risk assessment: one directive, same-origin mic only; the reverse (deny-all) is the
broken state. No client bundle changed; no database, function or desktop change.

## Rollback

1. `git revert` the two files (`scripts/serve-web-dist.cjs`,
   `scripts/securityHeaders.cjs`) on the deploy machine.
2. Restart the server (`scripts/start-murmur-stack.ps1` or manual relaunch).
3. Verify the old header returns. (Only for safety emergencies — it restores the bug.)

## Pending deployment (EAS)

Nothing deployed: EAS builds require the operator login. No production mobile
artifact exists yet.

## Post-deploy verification still required

- Operator: reload `https://notes.giscop.com` on Android Chrome (force-close Chrome
  first), confirm the mic prompt appears and a short recording saves and appears in
  the account.
