import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

/**
 * Ensures the app has permission to show local pop-up notifications.
 * Returns true if granted. No-op on web. Never throws.
 */
export async function ensureNotificationPermission(): Promise<boolean> {
  if (Platform.OS === "web") return false;
  try {
    const current = await Notifications.getPermissionsAsync();
    if (current.status === "granted") return true;
    if (!current.canAskAgain) return false;
    const req = await Notifications.requestPermissionsAsync();
    return req.status === "granted";
  } catch {
    return false;
  }
}

/**
 * Presents an immediate local notification (foreground pop-up alert).
 * No-op on web. Never throws.
 */
export async function notifyLocal(title: string, body: string, data: any = {}) {
  if (Platform.OS === "web") return;
  try {
    await Notifications.scheduleNotificationAsync({
      content: { title, body, data, sound: "default" },
      trigger: null,
    });
  } catch {
    // local notifications are best-effort
  }
}
