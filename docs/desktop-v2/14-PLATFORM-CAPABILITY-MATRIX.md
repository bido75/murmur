# Platform capability matrix (Desktop V2, Phase 7)

Machine-readable twin: `platform-capabilities.json`.

| Capability | Windows 10/11 x64 | macOS 13+ | Linux |
|---|---|---|---|
| App launch / UI | READY (boot smoke run here) | READY (CI lane) | UNTESTED |
| Sign in (OTP) | IMPLEMENTED (webmail SMTP path live for web) | same | same |
| OAuth (Google, PKCE) | IMPLEMENTED BUT NOT TESTED — needs registered redirect URIs (DB-04) | same | same |
| Microphone recording | IMPLEMENTED BUT NOT LIVE-TESTED | same + TCC prompt | UNTESTED |
| System audio | IMPLEMENTED BUT NOT LIVE-TESTED (loopback via screen picker) | IMPLEMENTED BUT NOT LIVE-TESTED (ScreenCaptureKit helper + TCC) | UNSUPPORTED (no UI offered) |
| Screen recording | IMPLEMENTED BUT NOT LIVE-TESTED | same | UNSUPPORTED |
| Local transcription (Parakeet int8) | IMPLEMENTED BUT NOT LIVE-TESTED (needs model download + soak) | same | UNTESTED |
| Cloud transcription | IMPLEMENTED (existing process-recording pipeline) | same | same |
| AI notes/summaries | IMPLEMENTED (shared server pipeline) | same | same |
| Transcript viewer | IMPLEMENTED BUT NOT TESTED signed-in | same | same |
| Dictation + global shortcuts + overlay | IMPLEMENTED AND VERIFIED (logic) / NOT TESTED (hardware) | same | same |
| Floating recording controller | IMPLEMENTED BUT NOT TESTED (needs signed-in recording run) | same | N/A |
| Onboarding checklist | IMPLEMENTED (shared web logic) | same | same |
| Integrations status | IMPLEMENTED BUT NOT TESTED (RLS read) | same | same |
| Crash log | IMPLEMENTED AND VERIFIED | same | same |
| Installer | CONFIGURED, unsigned (DB-02) | CONFIGURED, notarization pending (DB-03) | DEFERRED (DB-08) |
| Auto-update | BLOCKED-PREPARED (DB-07) | same | — |

Legend: READY = executed in this environment; IMPLEMENTED = code complete with unit
evidence; IMPLEMENTED BUT NOT LIVE-TESTED = code complete, real-device run outstanding;
UNTESTED/UNSUPPORTED = exactly what the word says. Nothing is upgraded to a stronger
claim than its evidence.
