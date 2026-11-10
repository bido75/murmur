{
  "date": "2026-10-29",
  "blockers": [
    { "id": "DB-01", "severity": "high", "what": "Real app bundle id (com.example.murmur.desktop is a placeholder)", "owner": "operator", "why": "Immutable after distribution; needed before any signed/notarized build" },
    { "id": "DB-02", "severity": "high", "what": "Windows code signing certificate", "owner": "operator", "why": "Unsigned installers must never be distributed (SmartScreen/AV friction and integrity risk)" },
    { "id": "DB-03", "severity": "high", "what": "Apple Developer credentials for notarization", "owner": "operator", "why": "Gatekeeper blocks unsigned/notarization-missing apps" },
    { "id": "DB-04", "severity": "high", "what": "OAuth redirect URIs registered for the desktop loopback/deep-link callback", "owner": "operator", "why": "Live Google sign-in completion; code path implemented and unit-tested (BL-4b pattern)" },
    { "id": "DB-05", "severity": "high", "what": "AGPL legal sign-off (BL-LEGAL)", "owner": "operator/legal", "why": "Distribution gate; no Murmure source used; Parakeet weights CC BY 4.0 with attribution shipped" },
    { "id": "DB-06", "severity": "medium", "what": "Real-hardware verification run (mic, system audio, ONNX soak, drift, signed-in E2E)", "owner": "operator + developer", "why": "Acceptance criteria 3/4/6/7 and several IMPLEMENTED BUT NOT TESTED rows" },
    { "id": "DB-07", "severity": "low", "what": "Auto-update feed infrastructure (signed, pinned HTTPS)", "owner": "operator", "why": "Enablement deliberately deferred until signing works end-to-end (D-19)" },
    { "id": "DB-08", "severity": "low", "what": "Linux distribution decision", "owner": "operator", "why": "D-20 deferred; no broken UI shipped" },
    { "id": "DB-09", "severity": "medium", "what": "Desktop editor surfaces (transcript editing, task actions, rename, delete)", "owner": "developer backlog", "why": "Each editor adds a conflict rule that must ship with it (10-OFFLINE-SYNC.md)" }
  ]
}
