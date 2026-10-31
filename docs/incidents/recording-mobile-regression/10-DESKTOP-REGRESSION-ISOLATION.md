# Desktop regression isolation

Question: did the desktop V2 work break web recording or Expo?

**No — with evidence, not assumption.**

- Every desktop V2 commit (`70043f0`…`d3902d5` on `feature/murmur-desktop-v2`) touches
  `desktop/**`, `docs/desktop-v2/**`, `.github/workflows/desktop*.yml`, or
  `scripts/securityHeaders*`/`serve-web-dist.cjs` (the header fix). None touch
  `src/lib` recording logic, `app.json`, Metro config, or Supabase behavior.
- The one cross-cutting change during the window was the **security hardening commit
  `2065aac`** on `feature/murmur-app-remediation` (shared deploy surface:
  `serve-web-dist.cjs`) — and that is precisely where root cause A lives. So the
  correlation "failure appeared during desktop V2 development" resolves to the
  hardening pass that ran concurrently, not to desktop code.
- Boundary checks (from the node:test remediation, same day): web bundles contain zero
  desktop/Electron code; desktop bundles contain zero test code; `desktop/` is a
  self-contained tree with its own tsconfig/tests.

No desktop feature was removed, and none needs to be.
