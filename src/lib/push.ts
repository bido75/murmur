// "Notes ready" notifications: register this phone with Expo's push service and open the
// recording when a notification is tapped. Phones only; the web app doesn't register.
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { Platform } from 'react-native';
import { isWeb } from './dialog';
import { supabase } from './supabase';

if (!isWeb) {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
  });
}

/** Ask once, then save the device token. Safe to call on every launch; never throws. */
export async function registerForPush(): Promise<void> {
  if (isWeb || !Device.isDevice) return;
  try {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', { name: 'Notes', importance: Notifications.AndroidImportance.DEFAULT });
    }
    const current = await Notifications.getPermissionsAsync();
    const granted = current.granted || (await Notifications.requestPermissionsAsync()).granted;
    if (!granted) return;
    const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
    if (!projectId) return; // set after `eas init`; see README
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    await supabase.from('push_tokens').upsert({ token, platform: Platform.OS === 'ios' ? 'ios' : 'android' }, { onConflict: 'token' });
  } catch {
    // Notifications are a convenience; recording works without them.
  }
}

/** Tapping a "Notes ready" notification opens that recording. Returns an unsubscribe function. */
export function listenForNotificationTaps(): () => void {
  if (isWeb) return () => {};
  const open = (data: unknown) => {
    const d = data as { recording_id?: string; t?: string } | undefined;
    const id = d?.recording_id;
    const t = d?.t && /^\d+$/.test(d.t) ? d.t : undefined; // topic alerts jump to the moment
    // Wait for navigation to be ready when the app was opened from the notification.
    if (id) setTimeout(() => router.push({ pathname: '/recording/[id]', params: t ? { id, t } : { id } }), 400);
  };
  const last = Notifications.getLastNotificationResponse();
  if (last) open(last.notification.request.content.data);
  const sub = Notifications.addNotificationResponseReceivedListener((r) => open(r.notification.request.content.data));
  return () => sub.remove();
}
