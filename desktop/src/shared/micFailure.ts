// How a failed microphone acquisition is explained to the user. Pure and testable:
// the renderer supplies the device probe and the user agent so no browser globals are
// needed here. `enumerateDevices` is a diagnostic, never a gate — the real signal is
// the getUserMedia rejection, classified by its error name.

export type MicDeviceInfo = {
  audioInputs: number;
  hasCamera: boolean;
  remoteOnly: boolean;
} | null;

/** A specific, actionable reason a microphone is missing, from the device probe. */
export function micHint(d: MicDeviceInfo, ua: string): string {
  if (d?.remoteOnly) {
    return 'This looks like a Remote Desktop session. In the RDP client, enable "Record from this computer" (Local Resources → Remote audio) so your local microphone is available here — or plug a microphone into this computer. Playback devices are not microphones.';
  }
  if (d?.hasCamera) {
    return "Your camera was detected, but it has no microphone (camera-only), or its microphone driver is missing. Plug in a microphone or headset and try again. In Windows, confirm the webcam microphone appears under Settings → System → Sound → Input.";
  }
  return ua.includes("Windows")
    ? "Check Windows Settings → Privacy → Microphone → allow desktop apps to access your microphone, and confirm a microphone appears under Settings → System → Sound → Input."
    : ua.includes("Mac")
      ? "Check System Settings → Privacy & Security → Microphone."
      : "Check your operating system's microphone settings.";
}

/** Turn a getUserMedia rejection into an actionable, user-facing message. */
export function micFailureMessage(
  name: string | undefined,
  detail: string,
  device: MicDeviceInfo,
  ua: string,
): string {
  switch ((name ?? "").toLowerCase()) {
    case "notfounderror":
    case "devicesnotfounderror":
      return "No microphone was found. " + micHint(device, ua);
    case "notallowederror":
    case "securityerror":
      return "Microphone access is off. Allow it in your system settings (Windows Settings → Privacy → Microphone, or System Settings → Privacy & Security → Microphone on Mac).";
    case "notreadableerror":
    case "trackstarterror":
      return "Your microphone is busy or could not be opened. Close any other app using it, then try again.";
    case "overconstrainederror":
      return "The selected microphone does not support the requested settings.";
    case "aborterror":
      return "Opening the microphone was cancelled.";
    default:
      return "Couldn't open the microphone" + (detail ? ` (${detail.slice(0, 160)})` : "") + ".";
  }
}