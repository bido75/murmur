# Installation tests (Desktop V2 distribution)

Rule: **a CI packaging success is not an installation pass.** Every row below is
evidence-classified, and anything needing hardware says BLOCKED rather than PASS.

## Executed in CI / locally (real commands)

| Check | Where | Result |
|---|---|---|
| Windows installer produced and >10 MB | local build on this machine | PASS — `Murmur-Setup-0.1.0-win-x64.exe`, 127.4 MB, SHA-256 recorded in the manifest |
| onnxruntime binaries unpacked outside asar (win) | local build | PASS — `app.asar.unpacked/.../win32/x64` present; `darwin` pruned |
| Signature honesty check (win) | local build | PASS — `Get-AuthenticodeSignature` → `NotSigned` (recorded as unsigned, no over-claim) |
| Update metadata emitted (latest.yml, blockmap) | local build | PASS |
| macOS builds + content verification (helper in zip, app binary present) | CI matrix legs | see `installer-test-results.json` (filled from the run) |
| Checksums generated | both | PASS (SHA256SUMS.txt per artifact set) |

## Real-hardware acceptance — BLOCKED (no machines beyond this Windows dev box)

### Windows (this machine can partially run these)
| Test | Status |
|---|---|
| Installer launches | BLOCKED — requires closing the dev session's file locks and a deliberate install; **offered as the operator's next step** |
| Installation completes; Murmur opens | BLOCKED |
| Sign-in works | BLOCKED (needs the live backend + user) |
| Microphone permissions; recording | BLOCKED (no microphone hardware attached) |
| Local transcription | BLOCKED (needs model download + audio) |
| Data survives restart | BLOCKED |
| Uninstall works; upgrade preserves user data | BLOCKED — and note: upgrade tests across an appId change (DB-01) are meaningless until the final id is fixed |

### macOS (Intel + Apple Silicon)
All rows BLOCKED — no macOS machine available. CI legs verify packaging structure
only (contents of zip/dmg, checksums, helper presence).

## Definition of done for install testing

A signed-or-explicitly-unsigned test build installed by a human on each claimed
platform, with the rows above individually recorded, plus an uninstall and an
upgrade run on Windows before the appId decision is closed.
