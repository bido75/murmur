# Access control

## Roles

| Role | Can |
|---|---|
| Recording owner | Everything on their recordings: edit, share, move, delete |
| Team member | Read recordings, notes and tasks in the team's projects; add recordings to them |
| Team admin | Members plus: invite/remove people, change roles, set team policies, see usage and the audit log, verify domains, manage SCIM |
| Team owner | Admin plus: cannot be removed by SCIM or by other admins |

Team admins **cannot** see members' personal recordings.

## Team policies (admin console → Policies)

Apply to every recording in the team's projects, on top of personal settings (the stricter wins):
redaction (PII / PHI / card numbers / long numbers), audio and recording retention, public links
on/off and maximum link lifetime, and a required consent choice before recording.

## Audit log (admin console → Audit)

Written by database triggers, so it cannot be skipped by a client: membership and role changes,
invites, policy changes, public links made or revoked, recordings deleted or moved in/out,
projects created/deleted/moved, domain verification, SCIM changes. Personal security events
(API tokens, linked devices, connected apps, data exports, links on personal recordings) are
visible to the person in Privacy & data. Rows cannot be edited or deleted by any user. Export as CSV.

## Sign-in

- Email one-time codes (no passwords to leak).
- **Company domain:** an admin claims a domain and proves it with a DNS TXT record; people who sign
  in with a confirmed email at that domain join the team automatically (can be turned off).
- **SAML single sign-on:** Okta, Microsoft Entra ID, Google Workspace and other SAML 2.0 providers,
  configured per domain by the operator (see [sso.md](sso.md)). Domains can be marked "SSO
  required": the auth server then refuses to issue a token for any session at that domain that
  didn't start with SSO (Supabase access-token hook `custom_access_token_hook`), so email codes
  stop working and older sessions end at their next refresh. The app shows only the SSO button.
- **SCIM 2.0:** identity providers add and remove team members automatically (Users endpoint,
  filter by userName, PATCH active). Removing a person removes their team access; their personal
  recordings stay theirs.

## Tokens

| Token | Prefix | Can | Stored as |
|---|---|---|---|
| Personal API / MCP | `mur_` | Read what the user can read; tick tasks | SHA-256 hash |
| Device (extension, watch) | `mdv_` | Create and upload recordings only | SHA-256 hash |
| SCIM | `scim_` | Manage one team's membership | SHA-256 hash |
| OAuth (Claude/ChatGPT connectors) | — | Same as API token, revocable per app | hashed |

All are revocable in the app; revocation is immediate.

## Operator access

Production database and function secrets are reachable only through the Supabase dashboard/CLI.
Enforce MFA on the Supabase organization, limit membership, and review it quarterly
(see soc2-readiness.md).
