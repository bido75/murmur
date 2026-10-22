// Asking for the microphone. On a phone the system asks and the app reads the answer;
// in a browser the browser owns the microphone, so the app asks the browser directly and
// can say why it said no.
import { requestRecordingPermissionsAsync } from 'expo-audio';
import { isWeb } from './dialog';
import { micMessage, micProblem } from './shared';

/** Ask for the microphone, or explain why it is not available. */
export async function requestMic(): Promise<void> {
  if (!isWeb) {
    const perm = await requestRecordingPermissionsAsync();
    if (!perm.granted) throw new Error(micMessage('blocked', 'native'));
    return;
  }
  const devices = typeof navigator === 'undefined' ? undefined : navigator.mediaDevices;
  if (!devices?.getUserMedia) throw new Error(micMessage('no-support', 'web'));
  try {
    const stream = await devices.getUserMedia({ audio: true });
    // Let go straight away: the recorder opens its own stream when it starts, and a
    // microphone that is held open shows the recording light for nothing.
    for (const track of stream.getTracks()) track.stop();
  } catch (e) {
    throw new Error(micMessage(micProblem((e as { name?: string })?.name), 'web'));
  }
}
