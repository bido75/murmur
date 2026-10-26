# 12 — Dependency, licensing and privacy review

## Dependencies (re-verified this remediation)

| Area | Finding |
|---|---|
| App (`npm audit --omit=dev`) | 8 advisories (5 high, 3 moderate), **all in Expo build/lint tooling**. Proof they do not ship: the built iOS bundle was searched — 0 occurrences of any vulnerable package name. |
| Fixed this engagement | `decode-uri-component` pinned to 0.5.1 via overrides (was reachable through `expo-router`) |
| Desktop | 0 vulnerabilities |
| Node runtime | 24.x — supported |
| One advisory unfixable upstream | `node-forge` ≤1.4.0 (no fixed release); build-time only |

## Licensing

| Item | Status |
|---|---|
| Murmure (AGPL-3.0) source | **Not used** — re-verified by `git grep` against copied identifiers on this branch; engine is an independent implementation |
| Parakeet model | CC BY 4.0 — attribution shipped in-app (desktop speech panel + phone privacy screen), credits all three parties (NVIDIA, Moondream, @thiswillbeyourgithub) |
| Whisper model (phone) | MIT — credited anyway |
| New branch dependencies | First-party only; no new third-party licences introduced |
| Legal review | **BLOCKED** — a lawyer must confirm the clean-room boundary (see `LICENSE_REVIEW.md`) |

## Privacy posture (verified against code and DB tests)

- Audio: deleted only after successful upload; retention deletes audio and
  recordings on schedule (`retention_due`, service-only, DB-tested).
- Local-only recordings: audio never uploaded; enforced by `transcription_mode`
  rules that beat every other choice (14 tests).
- AI training: Deepgram MIP opt-out sent by default; prompts state recordings
  aren't used for training. The privacy screen describes the actual provider
  (verified: `notes-provider` endpoint drives it).
- Account deletion: guarded against last-owner team breakage (DB-tested).
- Subprocessors: listed in `docs/security/subprocessors.md` (Google, Deepgram,
  Anthropic, OpenRouter, Ollama-on-device, Aircall, Recall, Resend, Twilio,
  Aircall, calendar/CRM connectors).

## Outstanding

- `node-forge`: watch for the upstream fix.
- Legal: Murmure boundary sign-off.
- Privacy policy text should name the actual notes provider dynamically if the
  deployment uses OpenRouter instead of Claude (the screen already asks the
  server; policy copy should match).