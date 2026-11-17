# Release architecture (Desktop V2 distribution)

Date: 2026-10-29 · Branch `feature/murmur-desktop-v2` · Workflow: `.github/workflows/desktop-release.yml`

## The path from source to a user's disk

```
tag push (desktop-v*) or manual dispatch
        │
        ▼
┌────────────────────────────────────────────────────────────┐
│ build matrix (three independent jobs, least privilege)     │
│  win-x64   windows-latest   → Murmur-Setup-<v>-win-x64.exe │
│  mac-arm64 macos-latest     → Murmur-<v>-arm64.dmg/.zip    │
│  mac-x64   macos-13         → Murmur-<v>-x64.dmg/.zip      │
│                                                            │
│ each job: checkout → npm ci → typecheck → tests → bundles  │
│           → (mac: swift helper) → electron-builder         │
│           → content verification → SHA-256 → artifact      │
└────────────────────────────────────────────────────────────┘
        │  (only on explicit dispatch with publish=true)
        ▼
┌────────────────────────────────────────────────────────────┐
│ publish-prerelease (contents: write, runs only after all   │
│ three legs succeeded) → draft GitHub pre-release,          │
│ installers + SHA256SUMS attached, tagged at the build SHA  │
└────────────────────────────────────────────────────────────┘
```

## Design rules

1. **No untrusted code near publishing.** The workflow has no `pull_request` trigger;
   the privileged job exists only behind an explicit dispatch and a `publish=true`
   choice. Ordinary PR CI (`.github/workflows/desktop.yml`) stays read-only.
2. **A failed leg cannot publish.** `publish-prerelease` `needs: build`; a skipped or
   failed matrix leg skips the publish job entirely — no partial releases.
3. **Signing gates are honest.** Each platform has a gate step: without credentials it
   announces "UNSIGNED (test/pre-release only)"; if credentials are ever configured
   before the signing step is implemented, the build **fails** rather than producing a
   half-signed artifact.
4. **Nothing publishes without a human decision.** Draft + prerelease by default;
   flipping a draft to a full release is an operator action in the GitHub UI.
5. **Every artifact is hashed.** SHA256SUMS.txt is produced inside each build job and
   uploaded with the installers.

## Versioning

- `desktop/package.json` carries the canonical version (currently `0.1.0`).
- Dispatch builds stamp the requested version into package.json inside the runner
  (never committed); tag builds use the committed version.
- Release tags follow `desktop-v<semver>`; prereleases append `-test` for evaluation
  builds so they can never be mistaken for production tags.

## Identity (paused, per operator decision)

- appId remains the placeholder `com.example.murmur.desktop` and is marked in
  `electron-builder.yml`. Changing it changes the installed app's identity: the
  switch must happen **before any installer is treated as an upgrade path**, or users
  get a parallel install. See `09-REMAINING-OPERATOR-ACTIONS.md`.
- Proposed id: `com.giscop.murmur`, subject to domain ownership confirmation.
