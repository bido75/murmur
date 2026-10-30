# Model management (Desktop V2, Phase 3)

Status as of 2026-10-29, traced to `desktop/src/shared/speechModels.ts`,
`desktop/src/main/speechModelManager.ts`, `desktop/src/renderer/speechPanel.ts`.

## What exists today

| Requirement (master prompt §18) | Status | Evidence |
|---|---|---|
| Dedicated Models UI | IMPLEMENTED (speechPanel shows status/size/attribution/install/remove; richer screen deferred to Phase 4 UX pass) | `speechPanel.ts` |
| Installed/available models + size | IMPLEMENTED — the Parakeet bundle reports id, label, per-file presence and sizes | `speech:model` IPC → `speechModelManager.installedFiles` |
| Language support | IMPLEMENTED — the bundle declares its supported languages; the desktop passes a language hint (or null = auto) | `transcribe:local` options |
| Download status + progress | IMPLEMENTED — `speech:progress` events with per-file percent, downloading/verifying/done stages | `speechModelManager.installModel` |
| Verification | IMPLEMENTED — archive SHA-256 **and** every extracted file's SHA-256 must match the bundle manifest before use; a version marker records accepted files | `speechModelManager.ts:236,303-316` |
| HTTPS + trusted source | IMPLEMENTED — single pinned HTTPS release URL | `speechModels.ts:79` |
| Atomic installation | PARTIAL — files land under a staging directory and the marker is written after all digests verify; the final rename of the whole directory is not yet a single atomic operation | `speechModelManager.ts` |
| Interrupted-download recovery | IMPLEMENTED — an AbortController cancels the fetch; a partial install is detected by the marker (version/digest mismatch) and re-downloaded on the next install | `installAbort` + marker check |
| Disk-space checks | MISSING — no free-space check before download; recorded as a Phase 4 item | — |
| Delete option | IMPLEMENTED | `speech:remove` |
| Model version tracking | IMPLEMENTED — `marker.version === bundle.version && marker.files[name] === sha256` | `speechModelManager.ts:96` |
| Licensing information | IMPLEMENTED — CC BY 4.0 attribution text ships in the app UI and docs | `speechModels.ts:47-50` |
| No arbitrary execution of downloaded files | IMPLEMENTED — downloaded content is only ever opened by the ONNX runtime as data; nothing extracted is executed | `transcriber.ts` |

## Honest limits

- Only one model (Parakeet TDT 0.6B v3 int8) is shipped today; a model *list* screen
  (multiple engines, hardware-requirement display) arrives with the Phase 4 Models
  screen. The interface (`SpeechModelStatus`) already carries what that screen needs.
- The runtime (`onnxruntime-node`) ships inside the installer rather than being
  downloaded; engine availability is checked by actually probing the IPC path
  (`ParakeetProvider.isAvailable`).
- Disk-space pre-check and full-directory atomic rename are tracked in the
  implementation matrix as open items, not claimed.
