# 10 — Long-recording and performance validation

Status: **PARTIALLY VERIFIED** — the server pipeline was measured end to end at
15/30/60 minutes with real audio; client-side (on-device recording) memory and
battery remain **BLOCKED (hardware)**.

## Environment

Local Supabase stack (kong + storage + Postgres in Docker) with the real edge
functions; STT = Mistral voxtral-mini with the Deepgram fallback; notes =
OpenRouter. Fixtures: 12 distinct ~5-minute English speech segments generated
with Windows SAPI TTS (varied scripts, ~150 wpm), uploaded as the app does —
5-minute segments with a shorter final one, 16 kHz/16-bit WAV.

Tool: `scripts/test-long-recording.cjs <minutes>` (committed; reproducible).

## Measured results (executed 2026-10-28)

| Length | Segments | Audio uploaded | Upload phase | Processing (STT + notes) | Total | Final state | Notes present |
|---|---|---|---|---|---|---|---|
| 2 min (probe) | 1 | 3.8 MB | 0.5 s | 12.3 s | 12.7 s | ready | yes |
| 15 min | 3 | 28.8 MB | 7.8 s | 328 s | 336 s | ready | yes |
| 30 min | 6 | 57.6 MB | 11.0 s | 334 s | 345 s | ready | yes |
| 60 min | 12 | 115 MB | 9.1 s | 602 s | 611 s | ready | yes |

Upload is near-instant (LAN storage); processing scales roughly linearly with
audio length (~100 s per 5-min segment of sequential STT + one summarization).

## Two production defects found and fixed during this testing

1. **Unbounded notes prompt** — the whole transcript went into one LLM prompt.
   During the first 30-minute rehearsal the transcript reached 376 KB
   (≈94K tokens) and the edge worker died silently mid-summarization, leaving
   the recording stuck in `summarizing` forever. Fix: `userMessage` now caps
   the transcript at 120K chars with a visible truncation marker (3 unit
   tests). After the fix the 30- and 60-minute runs completed.
2. **Stuck transient states** — a worker death left recordings in
   `uploading`/`transcribing`/`summarizing` forever. Fix:
   `fail_stale_processing()` (new migration, called by the daily retention
   sweep) fails anything stuck >2 h with a clear error (4 DB tests). Legitimate
   long recordings touch `updated_at` as they progress, so the threshold is
   safe.

Also characterized: very large single uploads (9.6 MB WAV per segment) hit
provider/runtime limits (Mistral `Signal timed out`, Deepgram http2 reset) —
the app's real segments are compressed m4a (~2.4 MB/5 min), which is why the
2-minute probe and all post-fix runs pass. Finding kept for the release notes:
segment *encoding* matters; no code change (the app already records AAC).

## Not measured here (BLOCKED)

- On-device memory/storage/battery during a 60-minute recording (hardware).
- Large-collection UI responsiveness (needs a populated device/local client).
- Transcript rendering at scale in the app UI (needs the device).
