# Environment configuration matrix (verified 2026-10-30)

## Resolution of the dev-client LAN failure (same day, later)

The operator ran `npx expo start --host lan` + the dev client and hit
`ConnectException: /10.0.0.180:54325`. Full chain, evidence-backed:

1. Expo loads `.env.local` **over** `.env` (its own log: `env: load .env.local .env`).
2. `.env.local` held `EXPO_PUBLIC_SUPABASE_URL = http://10.0.0.180:54325` — and
   **nothing has ever listened on 54325** (netstat empty; kong is 54321; the
   `lan-server-proxy` bridges 54321). The value was stale config drift, not a service.
3. Metro inlined that URL into the served bundle → the dev client dialed a dead port →
   `ConnectException`. No token was ever involved: the TCP connection itself had
   nowhere to go.

**Fix (deployed to the local dev config):** `.env.local` now points both
`EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_APP_URL` at `https://notes.giscop.com` —
the tunnel origin, reachable from any device and this machine, same backend instance.
Verified end-to-end: a throwaway Metro served the real Android bundle (6.0 MB) which
contains `notes.giscop.com` and zero references to `10.0.0.180` / `54325` /
`127.0.0.1:54321`. The operator reruns `npx expo start --clear` and the dev client
works from any network. The standalone preview APK was never affected (verified
byte-level earlier: tunnel origin only).

Dev-container hygiene note: `EXPO_PUBLIC_*` values are public by design; the anon key
is the publishable key. `SMTP_PASSWORD` still shares the file (flagged, no inline
exposure).

| Environment | Supabase URL | Public key | App/API origin | Notes |
|---|---|---|---|---|
| Hosted web (notes.giscop.com) | same instance via the tunnel origin | anon (public) | `https://notes.giscop.com` | `EXPO_PUBLIC_*` baked at bundle time |
| Local web dev | `https://notes.giscop.com` (`.env.local`) | anon (public) | same | fallback `.env` holds direct 127.0.0.1 values when `.env.local` is absent |
| Expo dev client (Metro) | `https://notes.giscop.com` (`.env.local`) | anon (public) | same | was the dead `10.0.0.180:54325` — the root cause of the dev-client login failure |
| Preview APK | baked at build: `https://notes.giscop.com` | anon (public) | same | verified inside the artifact |
| Electron desktop | inlined at build | anon (public) | same | — |
| Edge Functions | server-side; secrets in `supabase/functions/.env` | — | `PUBLIC_API_BASE_URL=https://notes.giscop.com`, `EXTERNAL_SUPABASE_URL=https://notes.giscop.com` (fixed from the dead 54325 value) | gitignored |

## Secret hygiene

- Only `EXPO_PUBLIC_*` values are inlined into client bundles; `SMTP_PASSWORD` sits in
  the same `.env` file (Expo loads it into process.env but does **not** inline it into
  bundles) — flagged for relocation to a dedicated functions-only env to remove the
  footgun. Rotation still pending from the earlier checklist (F-09).
- No service-role keys exist in any client env file (checked).
