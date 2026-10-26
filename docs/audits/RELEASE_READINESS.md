# Release readiness

## Decision: CONDITIONAL

Evidence-based reasons, per the severity gates in the audit prompt.

### Why not NO-GO

- **No confirmed critical code vulnerability.** The one critical-class code finding
  (webhook SSRF) is fixed with three layers and unit + DB tests.
- **No data-loss defect found.** Audio is persisted before processing; the pipeline
  survived a real end-to-end run; 77 DB security tests including cross-user denials
  pass.
- **No cross-user access gap found.** RLS negative tests (outsider/teammate/owner)
  pass across recordings, transcripts, notes, tasks, projects, teams, tokens,
  integrations, and shared links.
- **Core workflow proven.** sign-up → upload → Mistral transcription → OpenRouter
  notes → `ready`, with the transcript and notes correct and re-readable.
- **All automated suites green**: 185 logic + 10 app + 77 DB + 185 deno + 92
  desktop; tsc/lint/deno-check clean; iOS bundle and desktop build succeed.
- **Additive-only migrations**; no destructive statements; no committed secrets.

### Why not GO

1. **The branch has never been pushed** (`git ls-remote` confirms). No review, no
   backup. This alone blocks a production release.
2. **Live OAuth round-trips unverified.** Google rejects the local private-IP
   redirect; Slack/Procore/Google-Docs connects are configured server-side but not
   exercised through a real provider consent screen.
3. **Credentials exposed in chat are unrotated** (SEC-3). Until rotated, any
   deployment using them is compromised by construction.
4. **Interrupted-recording recovery (REQ-1.3b) has no test** — the one FAIL in the
   matrix, and it guards the product's central promise.
5. **Device/platform coverage gaps**: physical-device recording, screen-reader,
   macOS/Linux, 60-minute recording — all NOT TESTED.

## Gates to GO (in order)

| # | Gate | Owner | Effort |
|---|---|---|---|
| 1 | Push `feature/transcription-local` + `feature/murmur-app-remediation`, open PR | developer | minutes |
| 2 | Rotate all pasted credentials; move to a secret manager | developer | 1–2 h |
| 3 | Register OAuth redirect URIs in Google/Slack/Procore consoles; expose a public HTTPS origin (`PUBLIC_API_BASE_URL`) | developer | 1–2 h |
| 4 | Verify live OAuth round-trips (calendar connect, Slack connect, Procore sandbox) | developer + auditor | 1 h |
| 5 | Add + run the interrupted-recording recovery test (FIND-001) | developer | 2 h |
| 6 | Physical-device smoke: record 5 min, background it, crash-recover | developer | 1 h |

After gates 1–6: **GO** for an internal/beta release. Public production additionally
wants the performance baseline (FIND-010), webhook retry queue (FIND-009), and
legal sign-off on the Murmure licensing boundary (already documented in
`LICENSE_REVIEW.md`; a lawyer must confirm).

## Merge safety (independent of release)

The branch is safe to merge into `main`: fast-forwardable from main HEAD, no
deletions, no broken migrations, no committed secrets, no disabled tests, and every
suite passes. The only pre-merge tidy-ups: push it, commit the `docs/audits/`
deliverables, and optionally fix the 4 trailing-whitespace lines in
`scripts/test-transcription.mjs`.