import * as ImagePicker from "expo-image-picker";
import { Platform } from "react-native";

export type PickResult = { dataUri: string } | { error: string } | null;

/**
 * Launches the media library and returns a base64 data URI.
 * Handles permission flow gracefully. Returns null if the user cancels.
 */
export async function pickImageAsDataUri(): Promise<PickResult> {
  if (Platform.OS !== "web") {
    const current = await ImagePicker.getMediaLibraryPermissionsAsync();
    if (!current.granted) {
      if (!current.canAskAgain) {
        return { error: "settings" };
      }
      const req = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!req.granted) {
        return { error: req.canAskAgain ? "denied" : "settings" };
      }
    }
  }

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ["images"],
    allowsEditing: true,
    quality: 0.5,
    base64: true,
  });

  if (result.canceled || !result.assets?.length) return null;
  const asset = result.assets[0];
  const mime = asset.mimeType ?? "image/jpeg";
  if (!asset.base64) return { error: "read" };
  return { dataUri: `data:${mime};base64,${asset.base64}` };
}
