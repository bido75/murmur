// Alerts and confirms that also work on the web (React Native Web's Alert is a no-op).
import { Alert, Platform } from 'react-native';

export const isWeb = Platform.OS === 'web';

export function notify(title: string, message?: string) {
  if (isWeb) window.alert(message ? `${title}\n\n${message}` : title);
  else Alert.alert(title, message);
}

export function confirm(title: string, message: string, okLabel = 'OK', destructive = false): Promise<boolean> {
  if (isWeb) return Promise.resolve(window.confirm(`${title}\n\n${message}`));
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
