import { Platform, Alert } from "react-native";

/**
 * Cross-platform toast. Android: native Toast; iOS: Alert with single OK.
 */
export function showToast(message: string): void {
  if (Platform.OS === "android") {
    const { ToastAndroid } = require("react-native");
    ToastAndroid.show(message, ToastAndroid.SHORT);
  } else {
    Alert.alert("", message, [{ text: "OK" }]);
  }
}
