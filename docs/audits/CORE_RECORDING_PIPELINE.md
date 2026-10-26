# Core recording pipeline audit

Lifecycle traced from source: setup → consent → capture → local persistence →
upload queue → transcription → notes → tasks → search/export.

## Setup and consent

- Seven canonical types verified in `src/lib/types.ts` `TEMPLATE_LABELS`
  (General, Meeting, Lecture, Phone call, Site walk, Sales call, Interview) — one
  source of truth; resolves the audit's six-vs-seven confusion. **PASS**
- Type selection, project assignment (`ProjectPicker.tsx`), consent options and
  the recording-notice preference are wired and covered by DB tests. **PASS**

## Capture

- Permission handling in `src/lib/mic.ts` distinguishes an insecure page from an
  unsupported browser (unit-tested).
- Indicator, timer, level meter, pause/resume/stop/cancel implemented in
  `src/lib/recorder.ts`; verified on device this session.
- Mic-disconnection stall warning exists; the threshold was retuned during this
  engagement after a false-positive report (-55 dBFS for 60s). **PASS with note**
- Background recording: `expo-audio` needs a development build; Expo Go cannot
  background-record. **PARTIAL** (platform constraint, documented)

## Persistence, upload, recovery

- Audio is written to permanent storage and enqueued **before** processing
  (`sync.ts` `keepFile`/`keepRecording`); a processing failure never deletes
  audio. **PASS**
- Duplicate jobs prevented via `sttCacheKey` + `segment_transcripts` cache.
  **PASS**
- Upload retry exists (`Retry now` in Settings, `flush()`). **PASS**
- **Interrupted-session recovery (`recoverInterruptedRecording`) has no automated
  test and no end-to-end proof. FAIL** (FIND-001) — the one data-loss-path gap.

## Transcription

- Provider selection: `sttFallbackOrder` (configured → fallback), transient-error
  retry, redaction always to Deepgram (privacy promise kept). Unit-tested (6 tests).
- Invocation verified with a real WAV through both engines (Mistral primary,
  Deepgram fallback exercised during a DNS outage — the fallback demonstrably
  fired).
- Timestamps/speakers/language mapped from both providers' shapes
  (`mistralUtterances`, Deepgram mapping); verified against real audio
  (100ms/3400ms, speaker 0). **PASS**
- Persisted to `transcripts`/`segment_transcripts`; DB-tested. **PASS**

## AI notes and tasks

- Notes verified for real audio: overview + key_points correct and re-readable.
- Action items are verified against the transcript (`verify.ts`,
  16 tests) — no fabricated evidence; `field.ts` prevents invented owners/dates.
- Re-run and template-based notes wired; templates unit-tested.

## Verdict

Pipeline is real, tested, and proven end-to-end. The single gap is the
untested crash-recovery path (FIND-001, P0 in the backlog).