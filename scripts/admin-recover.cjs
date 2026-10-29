#!/usr/bin/env node
// Admin sign-in recovery for support: generates a one-time sign-in link for
// any email WITHOUT needing their mailbox to work (GoTrue admin generate_link
// does not send email — it returns the link for support to hand over).
//
//   node scripts/admin-recover.cjs <email>
//
// Local only: talks to 127.0.0.1:54321 with the service-role key read from the
// running stack (`supabase status`). Never expose this host publicly; the
// service-role key bypasses row-level security entirely.
const { execSync } = require("child_process");

const email = process.argv[2];
if (!email) {
  console.error("usage: node scripts/admin-recover.cjs <email>");
  process.exit(1);
}

let status;
try {
  status = execSync("supabase status -o json", { encoding: "utf8", maxBuffer: 1024 * 1024 });
} catch (e) {
  console.error("run from the murmur project root with the stack up");
  process.exit(1);
}
const s = JSON.parse(status.slice(status.indexOf("{"), status.lastIndexOf("}") + 1));
const key = s.SERVICE_ROLE_KEY;

const body = JSON.stringify({ type: "magiclink", email, redirect_to: "https://notes.giscop.com" });
const res = execSync(
  `curl.exe -s -X POST "http://127.0.0.1:54321/auth/v1/admin/generate_link" -H "Authorization: Bearer ${key}" -H "apikey: ${key}" -H "Content-Type: application/json" -d "${body.replace(/"/g, '\\"')}"`,
  { encoding: "utf8", maxBuffer: 1024 * 1024 },
);
const out = JSON.parse(res);
if (!out.action_link) {
  console.error("failed:", res.slice(0, 300));
  process.exit(1);
}
// The generated link should already carry the public origin (config.toml
// external_url = https://notes.giscop.com/auth/v1). If the stack was started
// without that setting, rewrite the local gateway host as a fallback.
const link = out.action_link
  .replace(/^http:\/\/127\.0\.0\.1:54321\/auth\/v1/, "https://notes.giscop.com/auth/v1")
  .replace(/redirect_to=[^&]*/, "redirect_to=https%3A%2F%2Fnotes.giscop.com");
console.log(`Sign-in link for ${email} (one-time; clicking it signs the user in and lands them in the app):`);
console.log(link);
console.log("");
console.log("Hand this link to the user over a verified channel (call/ticket, not email they cannot reach).");
console.log("The same endpoint works for type=signup/recovery/magiclink when needed.");
