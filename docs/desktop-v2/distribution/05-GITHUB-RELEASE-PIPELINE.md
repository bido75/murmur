# GitHub release pipeline (Desktop V2 distribution)

Workflow: `.github/workflows/desktop-release.yml` · Ordinary PR CI: `desktop.yml` (read-only)

## Triggers

| Trigger | What happens |
|---|---|
| `workflow_dispatch` (version + channel + publish inputs) | Full matrix build; stamping the given version; if `publish=true` and `channel=prerelease`, a **draft pre-release** is created |
| Push of tag `desktop-v*` | Full matrix build from the tagged commit; no automatic publication (artifacts only) |
| Pull requests / normal pushes | Nothing — this workflow never runs on untrusted code |

Note: `workflow_dispatch` becomes available from the default branch after PR #19
merges; until then, tag pushes (`desktop-v<version>-test`) are the trigger used for
controlled test builds, which is how the first artifacts were produced.

## Per-platform build steps (each matrix leg)

1. Check out the exact commit (`actions/checkout` SHA-pinned).
2. Node 22 via `actions/setup-node` (SHA-pinned, npm cache).
3. `npm ci` (lockfile-exact).
4. `npm run typecheck`.
5. `npm test` (full unit suite; a red test blocks the installer).
6. `node build.mjs` (app bundles).
7. macOS only: `npm run mac-helper` (Swift system-audio helper).
8. Per-arch pruning of onnxruntime binaries (mac legs).
9. `electron-builder --publish never` (win x64 / mac arm64 / mac x64).
10. Content verification: installer exists, >10 MB, and (mac) the zip contains the
    app binary and `SystemAudioCapture`.
11. `SHA256SUMS.txt` over all outputs.
12. Upload to the run's artifacts (`installer-win-x64`, `installer-mac-arm64`,
    `installer-mac-x64`), `if-no-files-found: error`.

## Publication rules

- The publish job requires **all three** legs; it downloads via `gh run download` and
  re-verifies presence of every platform's artifact before creating anything.
- The release is created as **draft + prerelease**, tagged at the exact build SHA
  (`--target`), titled "… (test build, unsigned)".
- Turning a draft into a public production release is deliberately a human action in
  the GitHub UI, and per `04-SIGNING-NOTARIZATION.md` it should only happen once
  signed artifacts exist.
- Permissions: build jobs `contents: read`; the publish job alone gets
  `contents: write`.

## Where users get installers (when published)

`https://github.com/bido75/murmur/releases` → the pre-release entry → assets.
Until a release is published, artifacts live inside the workflow run (private to
collaborators) — see `release-artifact-manifest.json` for the run links.
