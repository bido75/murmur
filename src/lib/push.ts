// "Notes ready" notifications: register this phone with Expo's push service and open the
// recording when a notification is tapped. Phones only; the web app doesn't register.
//
// expo-notifications is loaded lazily rather than imported at the top: on Android in
// Expo Go, importing it pulls in a remote-notification module that is not there, and the
// import itself throws. Push is a convenience, so when the module cannot load the app
// goes without it.
import Constants from "expo-constants";
import * as Device from "expo-device";
import { isRunningInExpoGo } from "expo";
import { router } from "expo-router";
import { Platform } from "react-native";
import { isWeb } from "./dialog";
import { supabase } from "./supabase";

type NotificationsModule = typeof import("expo-notifications");

let cached: NotificationsModule | null | undefined;

/** The notifications module, or null where it cannot be loaded (Expo Go on Android). */
function notifications(): NotificationsModule | null {
  if (cached !== undefined) return cached;
  if (isWeb || isRunningInExpoGo()) return (cached = null);
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return (cached = require("expo-notifications") as NotificationsModule);
  } catch {
    return (cached = null);
  }
}

/** Ask once, then save the device token. Safe to call on every launch; never throws. */
export async function registerForPush(): Promise<void> {
  if (isWeb || !Device.isDevice) return;
  const Notifications = notifications();
  if (!Notifications) return;
  try {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: false,
        shouldSetBadge: false,
      }),
    });
    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("default", {
        name: "Notes",
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }
    const current = await Notifications.getPermissionsAsync();
    const granted =
      current.granted ||
      (await Notifications.requestPermissionsAsync()).granted;
    if (!granted) return;
    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId ??
      Constants.easConfig?.projectId;
    if (!projectId) return; // set after `eas init`; see README
    const { data: token } = await Notifications.getExpoPushTokenAsync({
      projectId,
    });
    await supabase
      .from("push_tokens")
      .upsert(
        { token, platform: Platform.OS === "ios" ? "ios" : "android" },
        { onConflict: "token" },
      );
  } catch {
    // Notifications are a convenience; recording works without them.
  }
}

/** Tapping a "Notes ready" notification opens that recording. Returns an unsubscribe function. */
export function listenForNotificationTaps(): () => void {
  if (isWeb) return () => {};
  const Notifications = notifications();
  if (!Notifications) return () => {};
  const open = (data: unknown) => {
    const d = data as { recording_id?: string; t?: string } | undefined;
    const id = d?.recording_id;
    const t = d?.t && /^\d+$/.test(d.t) ? d.t : undefined; // topic alerts jump to the moment
    // Wait for navigation to be ready when the app was opened from the notification.
    if (id)
      setTimeout(
        () =>
          router.push({
            pathname: "/recording/[id]",
            params: t ? { id, t } : { id },
          }),
        400,
      );
  };
  const last = Notifications.getLastNotificationResponse();
  if (last) open(last.notification.request.content.data);
  const sub = Notifications.addNotificationResponseReceivedListener((r) =>
    open(r.notification.request.content.data),
  );
  return () => sub.remove();
}
