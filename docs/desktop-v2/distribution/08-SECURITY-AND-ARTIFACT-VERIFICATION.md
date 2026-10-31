# Security and artifact verification (Desktop V2 distribution)

## What exists

| Control | Evidence |
|---|---|
| Least-privilege workflows | `desktop-release.yml`: build jobs `contents: read`; only the publish job gets `contents: write`; no PR trigger, so untrusted code can never reach the privileged job |
| SHA-pinned actions | checkout/setup-node/upload-artifact use the repo's verified pins |
| No secrets in the repo | signing material referenced only as GitHub Actions secrets; the gates refuse to half-build if secrets appear without an implemented step |
| No secrets in logs | secrets are mapped to step env vars only; the release notes and logs contain no credentials |
| `.env` never committed | verified: `.gitignore` covers `.env`, `.env*.local`, `.env.functions`; `git check-ignore` confirms. The recent handoff ZIP leak came from a manual archive, not git — see the export policy below |
| Secret scan of packaged artifacts | the repo's `scripts/secret-scan.mjs` runs in CI on source; installer-level scanning is covered by the build running from a scanned tree plus the artifact inventory below |
| Native binary integrity | model downloads are SHA-256 verified (existing); the shipped onnxruntime binaries come from the npm lockfile, recorded in `release-artifact-manifest.json` |
| Dependency inventory | `desktop/package-lock.json` is the inventory; SBOM workflow covers the repo |
| Artifact provenance | every artifact set carries its workflow run id/URL and source SHA in `release-artifact-manifest.json` |
| Downloaded-binary integrity | `checkForUpdates` verifies via electron-updater's own checksum/blockmap when the gate ever opens; direct downloads are not part of the app |

## Source-archive export policy (fixing the reported leak)

The handoff ZIP included `.env*` and `.git/`. The sanctioned export is now:

```powershell
powershell -File scripts\export-source.ps1 -Out murmur-src.zip
```

- Uses `git archive` — walks the **committed tree only**: `.env*`, `node_modules`,
  `.git`, caches and build outputs cannot enter the archive because they are not
  tracked.
- Runs the secret scan first and aborts on findings.
- Refuses to overwrite an existing archive.

The exposed credentials from that ZIP should still be treated as compromised and
rotated (rows in `docs/post-audit/05-CREDENTIAL-ROTATION-CHECKLIST.md`); no local
files were deleted as part of this remediation.

## What remains open

- Signing the artifacts themselves (04) — the biggest trust gap; unsigned test
  installers are for restricted evaluation only.
- A reproducible-build story (byte-identical artifacts from the same commit) is not
  claimed; the SHA-256 manifest pins what was actually distributed.
