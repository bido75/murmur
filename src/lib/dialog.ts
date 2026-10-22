// Alerts and confirms that also work on the web (React Native Web's Alert is a no-op).
//
// The browser's own dialogs freeze the page while they are open, which is no use during a
// recording: the screen stops redrawing, the buttons stop answering and the audio carries
// on. So on the web the app asks in its own window (see components/Alerts).
import { Alert, Platform } from 'react-native';
import { askInApp, tellInApp } from '@/components/Alerts';

export const isWeb = Platform.OS === 'web';

export function notify(title: string, message?: string) {
  if (isWeb) tellInApp(title, message);
  else Alert.alert(title, message);
}

export function confirm(title: string, message: string, okLabel = 'OK', destructive = false): Promise<boolean> {
  if (isWeb) return askInApp(title, message, okLabel, destructive);
  return new Promise((resolve) =>
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
      { text: okLabel, style: destructive ? 'destructive' : 'default', onPress: () => resolve(true) },
    ]),
  );
}

/** Share sheet on phones; copy to clipboard on the web. */
export async function shareOrCopy(message: string, copiedNote = 'Copied to clipboard') {
  if (isWeb) {
    try {
      await navigator.clipboard.writeText(message);
      notify(copiedNote, message);
    } catch {
      notify('Copy this', message);
    }
    return;
  }
  const { Share } = await import('react-native');
  await Share.share({ message });
}
