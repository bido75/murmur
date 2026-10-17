// Android only: a foreground service (with the required notification) so the microphone keeps
// recording while the app is in the background. iOS and web don't need it.
import { requireOptionalNativeModule } from 'expo-modules-core';

type Native = { start(title: string, body: string): void; stop(): void };
const native = requireOptionalNativeModule<Native>('MurmurForeground');

export const foregroundAvailable = native !== null;

export function startForegroundRecording(title: string, body: string) {
  native?.start(title, body);
}

export function stopForegroundRecording() {
  native?.stop();
}
