// Regression guard for the P0 recording incident of 2026-10-30: the Permissions-Policy
// must never deny the microphone on the app's own origin.
import { createRequire } from "node:module";
import assert from "node:assert/strict";
import test from "node:test";

const require = createRequire(import.meta.url);
const { securityHeaders } = require("./securityHeaders.cjs");

test("the permissions policy allows same-origin microphone use", () => {
  const policy = securityHeaders().permissionsPolicy;
  assert.match(policy, /microphone=\(self\)/);
});

test("the permissions policy never deny-alls the microphone", () => {
  // The exact regression: "microphone=()" blocks getUserMedia before prompting.
  assert.doesNotMatch(securityHeaders().permissionsPolicy, /microphone=\(\)/);
});

test("the other tightened permissions stay denied", () => {
  const policy = securityHeaders().permissionsPolicy;
  assert.match(policy, /camera=\(\)/);
  assert.match(policy, /payment=\(\)/);
});

test("the other security headers remain in place", () => {
  const h = securityHeaders();
  assert.match(h.strictTransportSecurity, /max-age=31536000/);
  assert.equal(h.xContentTypeOptions, "nosniff");
  assert.equal(h.xFrameOptions, "DENY");
  assert.match(h.contentSecurityPolicyReportOnly, /report-uri/);
});
