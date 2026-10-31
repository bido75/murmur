// Update checks, prepared but deliberately dormant.
//
// Production auto-updates stay OFF until the artifact trust model is verified:
// Windows installers must be Authenticode-signed and macOS builds notarized,
// because an updater that happily replaces the app with an unsigned binary is
// itself a distribution-channel attack. The check logic is pure and tested; the
// electron-updater wiring only activates behind MURMUR_ENABLE_UPDATES=1, which the
// release docs say to set only after signing works end to end.

export type UpdateChannel = "stable" | "prerelease";

/** The channel a build reports, from its version suffix (0.2.0-beta.1 -> prerelease). */
export function channelOf(version: string): UpdateChannel {
  return /-(beta|alpha|rc)\./.test(version) ? "prerelease" : "stable";
}

/** Whether checking for updates is allowed in this build at all. */
export function updatesEnabled(opts: {
  envFlag: boolean;
  signingVerified: boolean;
  channel: UpdateChannel;
}): { allowed: boolean; reason: string } {
  if (!opts.signingVerified)
    return { allowed: false, reason: "Updates wait until signed installers are verified on both platforms." };
  if (!opts.envFlag)
    return { allowed: false, reason: "The operator has not enabled update checks (MURMUR_ENABLE_UPDATES=1)." };
  if (opts.channel === "prerelease")
    return { allowed: false, reason: "Test builds do not self-update; install the next build by hand." };
  return { allowed: true, reason: "Signed production build with update checks enabled." };
}

/** Semver-ish comparison so a stale build knows an update exists; no dependency. */
export function isNewerVersion(candidate: string, current: string): boolean {
  const parse = (v: string) =>
    v
      .replace(/^v/, "")
      .split(".")
      .map((p) => Number.parseInt(p, 10) || 0);
  const a = parse(candidate);
  const b = parse(current);
  for (let i = 0; i < 3; i++) {
    if ((a[i] ?? 0) > (b[i] ?? 0)) return true;
    if ((a[i] ?? 0) < (b[i] ?? 0)) return false;
  }
  return false;
}
