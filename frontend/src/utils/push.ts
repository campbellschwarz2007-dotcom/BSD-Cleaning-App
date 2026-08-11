import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

const BASE = process.env.EXPO_PUBLIC_BACKEND_URL;

/**
 * Registers the device for push notifications and sends the native token to
 * the backend. No-op on web / when permission is denied. Never throws.
 */
export async function registerForPush(userId: string) {
  if (Platform.OS === "web" || !userId) return;
  try {
    const { status } = await Notifications.requestPermissionsAsync();
    if (status !== "granted") return;
    const tokenResp = await Notifications.getDevicePushTokenAsync();
    await fetch(`${BASE}/api/register-push`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user_id: userId,
        platform: Platform.OS,
        device_token: String(tokenResp.data),
      }),
    });
  } catch {
    // push is best-effort; never block the app
  }
}
