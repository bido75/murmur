// Writes vercel.json so the web app's domain also serves, via rewrites to Supabase:
//   /mcp, /oauth/token, /oauth/register, /oauth/revoke and the OAuth discovery documents.
// One domain for everything is what MCP connectors (Claude.ai, ChatGPT) expect.
// Usage: EXPO_PUBLIC_SUPABASE_URL=https://xyz.supabase.co node scripts/hosting-config.mjs
import { writeFileSync } from 'node:fs';

const supa = (process.env.EXPO_PUBLIC_SUPABASE_URL ?? '').replace(/\/$/, '');
if (!/^https:\/\/.+/.test(supa)) {
  console.error('Set EXPO_PUBLIC_SUPABASE_URL (e.g. in .env) first.');
  process.exit(1);
}
const fn = `${supa}/functions/v1`;

const config = {
  $schema: 'https://openapi.vercel.sh/vercel.json',
  buildCommand: 'npx expo export --platform web',
  outputDirectory: 'dist',
  rewrites: [
    { source: '/.well-known/oauth-authorization-server', destination: `${fn}/oauth/.well-known/oauth-authorization-server` },
    { source: '/.well-known/oauth-protected-resource/mcp', destination: `${fn}/mcp/.well-known/oauth-protected-resource` },
    { source: '/.well-known/oauth-protected-resource', destination: `${fn}/mcp/.well-known/oauth-protected-resource` },
    { source: '/mcp', destination: `${fn}/mcp` },
    { source: '/oauth/token', destination: `${fn}/oauth/token` },
    { source: '/oauth/register', destination: `${fn}/oauth/register` },
    { source: '/oauth/revoke', destination: `${fn}/oauth/revoke` },
    // Single-page app: every other path renders the app (including /oauth/authorize).
    { source: '/(.*)', destination: '/index.html' },
  ],
};

writeFileSync('vercel.json', JSON.stringify(config, null, 2) + '\n');
console.log('Wrote vercel.json for', supa);
