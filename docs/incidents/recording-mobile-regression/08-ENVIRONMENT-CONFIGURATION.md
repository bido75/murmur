# Environment configuration matrix (verified 2026-10-30)

| Environment | Supabase URL | Public key | App/API origin | Notes |
|---|---|---|---|---|
| Hosted web (notes.giscop.com) | LAN/kong value at build; API proxied same-origin | anon (public) | `https://notes.giscop.com` | `EXPO_PUBLIC_*` from `.env`/`.env.local` at bundle time |
| Local web dev | same | same | `http://localhost:8081/…` | dev only |
| Expo Go / dev build | same | same | same as web | device fetches Supabase directly over LAN/tunnel URL — never `localhost` (the LAN IP `10.0.0.180:54321` or the tunnel domain is used; verified in `.env`) |
| Preview APK | `EXPO_PUBLIC_SUPABASE_URL` (real Supabase) | anon (public) | `EXPO_PUBLIC_APP_ORIGIN=https://notes.giscop.com` (new, set in eas.json preview/production) | tunnel domain is the app origin, **not** assumed to be the Supabase URL — the Supabase URL stays separate per the operator's instruction |
| Electron desktop | inlined at build from `../.env` | anon (public) | same values | — |
| Edge Functions | server-side; secrets in `supabase/functions/.env` | — | `PUBLIC_API_BASE_URL=https://notes.giscop.com`, `EXTERNAL_SUPABASE_URL` | gitignored |

## Secret hygiene

- Only `EXPO_PUBLIC_*` values are inlined into client bundles; `SMTP_PASSWORD` sits in
  the same `.env` file (Expo loads it into process.env but does **not** inline it into
  bundles) — flagged for relocation to a dedicated functions-only env to remove the
  footgun. Rotation still pending from the earlier checklist (F-09).
- No service-role keys exist in any client env file (checked).
