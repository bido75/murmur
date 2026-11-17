// The security headers the web server sends, in one testable place.
//
// The Permissions-Policy here is a product decision, not a scanner checkbox:
// Murmur records the microphone on the same origin it is served from, so
// microphone=(self) is required. A deny-all policy (shipped in the first
// hardening pass, 2026-10-29) silently blocks getUserMedia with NotAllowedError
// before the user is ever prompted - the P0 recording regression of 2026-10-30.
// The test in securityHeaders.test.mjs pins this so it cannot come back.

function securityHeaders() {
  return {
    strictTransportSecurity: "max-age=31536000; includeSubDomains",
    xContentTypeOptions: "nosniff",
    xFrameOptions: "DENY",
    referrerPolicy: "strict-origin-when-cross-origin",
    permissionsPolicy: "camera=(), microphone=(self), geolocation=(self), payment=()",
    contentSecurityPolicyReportOnly:
      "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' https://*.supabase.co https://api.openai.com https://api.anthropic.com https://openrouter.ai https://api.deepgram.com; frame-ancestors 'none'; report-uri /csp-report",
  };
}

module.exports = { securityHeaders };
