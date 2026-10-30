# Performance and reliability review

## Measured (this engagement)

| Measurement | Result |
|---|---|
| iOS bundle (Metro export, Hermes) | 4.2 MB, builds clean |
| Full pipeline latency (6s WAV) | sign-up→upload→transcribe→notes→`ready` in seconds when providers warm |
| Local Parakeet transcription | ~2.4× faster than real time on CPU (from TEST_RESULTS) |
| Local LLM notes (Ollama 3B, CPU) | ~110 s warm; >5 min cold — why `LLM_PROVIDER=openrouter` is the local default |
| DB suite | 77 tests incl. RLS, ~74 s (PGlite) |

## Not measured (explicitly NOT TESTED)

- Large recording collections (no seeded 500-row render test).
- Long-transcript rendering (the `ask` context cap is 150k chars; UI rendering of
  multi-hour transcripts unmeasured).
- Search latency at scale (RPC is indexed; no benchmark).
- Memory/CPU under concurrent uploads.
- Cold-start time on a physical device.

## Adverse conditions — verified by design, not by fault injection

| Condition | Behavior | Evidence |
|---|---|---|
| Network loss mid-recording | Segments kept locally in `pending/`, synced later; retry exists | `sync.ts` design + Settings retry |
| Provider DNS/API outage | STT falls back to the other engine; 3 retries on transient errors | Real run during a Docker DNS outage |
| LLM slow/unavailable | Timeout (`LLM_TIMEOUT_MS`, default 5 min) → recording marked failed, audio kept | `services.ts` |
| App crash mid-recording | Recovery path exists (`recoverInterruptedRecording`) | **UNTESTED — FIND-001** |
| Duplicate webhook delivery | Idempotent by consumer; server records last status only | `after_ready.ts` |
| Concurrent AI requests | Segments transcribed 4-at-a-time (`mapLimited`); budget-bounded | `pipeline.ts` |

## Recommendations

1. Fault-inject the crash-recovery path (the untested one) — highest value.
2. Seed-data benchmark before public launch.
3. Add the webhook retry queue before promising delivery guarantees.