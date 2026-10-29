# 05 — Credential rotation checklist

The credentials below were **pasted into chat** during the engagement and must be
treated as compromised. Each requires rotation through its provider's own
console. **Values are never restated here.** Rotation is an operator action;
the coding environment cannot access the provider consoles, so this is BLOCKED
pending operator execution.

| # | Provider | Credential type exposed | Console | Rotate by | Verify revocation |
|---|---|---|---|---|---|
| 1 | Google Cloud (Calendar, Google Docs OAuth) | OAuth client secret | console.cloud.google.com → APIs & Services → Credentials | Create a new client secret on the same OAuth client; update `GOOGLE_CLIENT_SECRET` | Old secret rejected at the token endpoint |
| 2 | Slack | App client secret + signing secret | api.slack.com/apps → the app → Basic Information | Regenerate signing secret; rotate app credentials | Old signing secret fails signature verification |
| 3 | Notion | Internal integration secret | notion.so/my-integrations → the integration | Regenerate the secret | Old token rejected by `users/me` |
| 4 | Atlassian (Jira) | OAuth client id/secret | developer.atlassian.com/console → the app | Rotate the client secret | Old secret fails at the token endpoint |
| 5 | Asana | OAuth client secret | app.asana.com → Apps | Create a new client secret | Old secret rejected |
| 6 | Linear | OAuth client secret | linear.app/settings/api → the app | Rotate | Old secret rejected |
| 7 | monday.com | OAuth client secret | auth.monday.com → Developers → the app | Regenerate | Old secret rejected |
| 8 | ClickUp | OAuth client secret + API key | app.clickup.com/settings/apps | Regenerate both | Old key rejected |
| 9 | Procore | OAuth client id/secret (sandbox) | developers.procore.com → the app | Rotate | Old secret rejected |
| 10 | HubSpot | Private-app access token (`pat-na2-…`) | HubSpot → Development → Legacy apps → the app → Auth → **Rotate** | Use "Rotate and expire now" (compromised) | Old token rejected by `/crm/v3/objects/notes` |
| 11 | Deepgram | API key | console.deepgram.com | Create new key, revoke old | Old key → 401 on `/v1/projects` |
| 12 | OpenRouter | API key | openrouter.ai/keys | Create new, revoke old | Old key → 401 |
| 13 | Mistral | API key | console.mistral.ai/api-keys | Revoke + create | Old key → 401 |
| 14 | Anthropic | API key | console.anthropic.com | Rotate | Old key → 401 |
| 15 | Aircall | API id + token | dashboard.aircall.io | Regenerate | Old pair → 401 on `/v1/ping` |
| 16 | Supabase (local dev) | Service role / anon keys are local-stack defaults; **no production keys were exposed** | supabase.com dashboard | Not required for local | — |
| 17 | **Cloudflare — Global API Key** | Full-account API key (highest privilege) — pasted into chat | dash.cloudflare.com → My Profile → API Tokens → **API Key → Roll** | Roll the Global API Key (or, better, replace its uses with scoped tokens); every use of the old key fails | Old key rejected by the Cloudflare API |
| 18 | **Cloudflare — scoped API token** (`cfut_…`) + **tunnel token** | Scoped API token and the `murmur-app` tunnel connector token — both pasted into chat | dash.cloudflare.com → My Profile → API Tokens (roll the API token); Zero Trust → Networks → Tunnels → murmur-app → **Refresh token** (tunnel token) | Roll the API token; refresh the tunnel token then redeploy the connector with the new token | Old API token → 401; old tunnel token's connector cannot connect |
| 19 | **cPanel mailbox** `info@giscop.com` | The webmail/SMTP password — pasted into chat and used for GoTrue SMTP | cPanel → Email Accounts → **Manage → Change Password** (also update `SMTP_PASSWORD` in the untracked local `.env` afterwards) | Change the password, update the local env, restart the stack | Old password fails SMTP login; new one sends via the app's sign-in flow |

## Procedure notes

- Update `supabase/functions/.env` (local) or `supabase secrets set …` (hosted)
  **after** creating replacements and **before** revoking the old values, so the
  app keeps working through the switch.
- Restart the local Edge Runtime after changing the env file:
  `powershell -ExecutionPolicy Bypass -File scripts\restart-local-functions.ps1 -FromFunctionsEnv`
- Never paste replacement values into chat, commits, or docs.

## Scan results (re-verified)

- `git grep` for every exposed-secret shape across the tree: **no real values
  committed** (only `sk-ant-...` doc placeholders).
- `.env`, `.env.local`, `supabase/functions/.env` gitignored (`git check-ignore`
  confirms).
- Client bundle searched previously: no key material present.