# Auth and security (Desktop V2, Phase 7)

Full machine-readable findings in `security-findings.json`.

## Threat model (desktop-specific)

Adversary classes considered: a compromised renderer page (XSS-style), another local
user/process, a tampered model download, a malicious OAuth redirect, and a user
switching accounts on one machine.

## Controls in place (verified against code)

1. **Renderer isolation** — `contextIsolation`, `nodeIntegration:false`, `sandbox:true`
   on the main window, dictation overlay, and floating controller. Preload bridges
   expose a fixed typed surface; event channels are allowlisted.
2. **IPC** — every filesystem path is derived main-side from validated inputs (UUID +
   bounded index + extension regex); settings patches are key-validated and value-
   normalized; the secure store bounds key/value sizes; `openExternal` is https-only;
   nothing exposes shell, raw Node, or unrestricted fs.
3. **Navigation** — in-app navigation is prevented; new windows are denied except
   https links handed to the system browser.
4. **CSP** — main window: self + explicit connect-src allowlist; overlay and floating
   windows: `default-src 'none'`.
5. **Token storage (fixed in Phase 7)** — Supabase refresh tokens now live in the main
   process behind `safeStorage` (DPAPI/Keychain/libsecret) instead of renderer
   localStorage. Unavailable-OS fallback writes entries flagged `plain:true` — visible,
   never silent. Corrupt/unopenable ciphertext degrades to sign-in, not error.
6. **Account isolation (fixed in Phase 6)** — the upload queue is quarantined per
   account on switch; recordings can never be uploaded under another user's session.
7. **Model supply chain** — pinned HTTPS release, archive + per-file SHA-256, version
   markers, cancellation, disk-space pre-check; downloaded files are data for the ONNX
   runtime, never executed.
8. **Local Only** — enforced at provider selection (tested) and structurally (local
   recordings are never uploaded; transcription runs in-process).
9. **Crash log** — bounded local JSONL, no recording content, redaction-friendly.

## Accepted risks (documented, not hidden)

- OAuth `state` is enforced by Supabase's PKCE verifier binding; the main process
  checks it when issued but does not duplicate the whole CSRF protocol.
- `openExternal(any https)` from a compromised renderer could open a phishing tab; it
  cannot read app data or execute code.
- Plaintext fallback when no OS key store exists (realistic only on some Linux
  setups) — flagged in the store file itself.

## Distribution gates

Unsigned installers must not be distributed (DB-01/02/03 in
`16-REMAINING-BLOCKERS.md`); AGPL review sign-off remains outstanding (DB-05).
