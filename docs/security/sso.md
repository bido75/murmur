# Single sign-on and SCIM — operator guide

## SAML SSO (per customer domain)

Requires Supabase Pro or above with SAML enabled (Authentication → Providers → SAML 2.0).

1. The customer's admin adds and **verifies** their domain in Admin console → Sign-in (DNS TXT).
2. The customer creates a SAML app in their identity provider:
   - ACS URL: `https://<project-ref>.supabase.co/auth/v1/sso/saml/acs`
   - Entity ID / Audience: `https://<project-ref>.supabase.co/auth/v1/sso/saml/metadata`
   - Name ID: email address
   They send you the IdP **metadata URL**.
3. Register it:
   ```bash
   supabase sso add --type saml --project-ref <ref> \
     --metadata-url 'https://idp.example.com/app/metadata' --domains acme.com
   supabase sso list --project-ref <ref>      # note the provider id
   ```
4. Link it to the domain (SQL editor, service role):
   ```sql
   update workspace_domains set sso_provider_id = '<provider id>', sso_required = true
   where domain = 'acme.com' and verified_at is not null;
   ```
5. Turn on the access-token hook once per project (Authentication → Hooks → Customize Access Token →
   Postgres function `public.custom_access_token_hook`). It refuses tokens for non-SSO sessions at
   SSO-required domains; without it, "SSO required" only changes what the app shows.
6. People with `@acme.com` emails now see **Continue with single sign-on**. Add the web app's
   `/sso-callback` and the app scheme (`murmur://sso-callback`) to Auth → URL Configuration →
   Redirect URLs.

## SCIM (Okta, Microsoft Entra ID, OneLogin)

In Admin console → Sign-in → **Create SCIM token**, then in the identity provider:

- SCIM base URL: `https://<project-ref>.supabase.co/functions/v1/scim/v2`
- Authentication: HTTP header / Bearer token = the `scim_…` token
- Unique identifier: `userName` (email)
- Supported actions: create users, deactivate users (and push profile updates — accepted, ignored)

Deploy the function with `supabase functions deploy scim --no-verify-jwt`.
