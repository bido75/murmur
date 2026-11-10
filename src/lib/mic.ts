// Asking for the microphone. On a phone the system asks and the app reads the answer;
// in a browser the browser owns the microphone, so the app asks the browser directly and
// can say why it said no.
import { requestRecordingPermissionsAsync } from "expo-audio";
import { isWeb } from "./dialog";
import {
  insecurePageMessage,
  micMessage,
  micProblem,
  noBrowserSupportMessage,
} from "./shared";

/**
 * Why the browser will not hand over the microphone.
 *
 * A browser only gives a page a microphone on a **secure** page: https, or
 * `localhost`. On a plain address on the network — `http://192.168.1.5:8090` — the
 * browser withholds the microphone entirely, and `navigator.mediaDevices` is not even
 * there. Saying "try another browser" for that sends people down the wrong road, so
 * this case is named on its own.
 */
export function micUnavailableReason(): string {
  if (typeof window === "undefined") return "";
  if (window.isSecureContext === false) return insecurePageMessage();
  return "";
}

/** Ask for the microphone, or explain why it is not available. */
export async function requestMic(): Promise<void> {
  if (!isWeb) {
    const perm = await requestRecordingPermissionsAsync();
    if (!perm.granted) throw new Error(micMessage("blocked", "native"));
    return;
  }
  const devices =
    typeof navigator === "undefined" ? undefined : navigator.mediaDevices;
  if (!devices?.getUserMedia) {
    // The page is not secure, so the browser has no microphone to give.
    const reason = micUnavailableReason();
    throw new Error(reason || noBrowserSupportMessage());
  }
  // Ask the browser directly. Device enumeration is unreliable here (Safari lists no
  // inputs before permission; an RDP session shows only Remote Audio playback; a camera
  // may have no mic), so it is never used to pre-empt the request — the browser gives
  // the real answer, and its error name tells us what to say.
  try {
    const stream = await devices.getUserMedia({ audio: true });
    // Let go straight away: the recorder opens its own stream when it starts, and a
    // microphone that is held open shows the recording light for nothing.
    for (const track of stream.getTracks()) track.stop();
  } catch (e) {
    const problem = micProblem((e as { name?: string })?.name);
    throw new Error(
      problem === "no-device"
        ? micMessage("no-device", "web") + " " + osMicGuidance()
        : micMessage(problem, "web"),
    );
  }
}

/** OS-level microphone guidance for desktop browsers. */
function osMicGuidance(): string {
  if (typeof navigator === "undefined") return "";
  const ua = navigator.userAgent;
  if (ua.includes("Windows")) {
    return "Check Windows Settings → Privacy → Microphone → allow apps to access your microphone, and make sure your browser is allowed too.";
  }
  if (ua.includes("Mac")) {
    return "Check System Settings → Privacy & Security → Microphone → make sure your browser is allowed.";
  }
  return "Check your operating system's microphone privacy settings.";
}
