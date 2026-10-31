// The file side of update checking, wired but dormant by default (see the pure
// logic in updater.ts and the conditions in docs/desktop-v2/distribution/06).
import { app } from "electron";
import electronUpdater from "electron-updater";
import { channelOf, isNewerVersion, updatesEnabled, type UpdateChannel } from "./updater";

const { autoUpdater } = electronUpdater;

export type UpdateStatus = {
  enabled: boolean;
  reason: string;
  channel: UpdateChannel;
  currentVersion: string;
  latestVersion: string | null;
  error: string | null;
};

const status: UpdateStatus = {
  enabled: false,
  reason: "not checked",
  channel: "stable",
  currentVersion: app.getVersion(),
  latestVersion: null,
  error: null,
};

/** The one gate every update check passes through; never bypassed by callers. */
export function updateGate(signingVerified: boolean): UpdateStatus {
  status.channel = channelOf(app.getVersion());
  const decision = updatesEnabled({
    envFlag: process.env.MURMUR_ENABLE_UPDATES === "1",
    signingVerified,
    channel: status.channel,
  });
  status.enabled = decision.allowed;
  status.reason = decision.reason;
  return status;
}

/** Check GitHub Releases for a newer version, when the gate allows it. */
export async function checkForUpdates(signingVerified: boolean): Promise<UpdateStatus> {
  const gate = updateGate(signingVerified);
  if (!gate.enabled) return gate;
  try {
    // electron-updater's channel names differ from ours; ours stays in status.
    autoUpdater.channel = gate.channel === "prerelease" ? "beta" : "latest";
    autoUpdater.autoDownload = false; // the user decides, in the UI
    const result = await autoUpdater.checkForUpdates();
    const version = result?.updateInfo?.version ?? null;
    status.latestVersion = version;
    if (version && isNewerVersion(version, app.getVersion())) status.reason = "An update is available.";
    else status.reason = "This build is current.";
  } catch (e) {
    status.error = (e as Error).message;
  }
  return status;
}
