import messaging from "@react-native-firebase/messaging";
import { Platform } from "react-native";
import { doc, setDoc } from "../lib/rnFirestore";
import { db, auth } from "../firebase";

const DEVICES_COLLECTION = "devices";

/**
 * Get a stable device ID for this app instance.
 * Uses a combination of platform and a random ID stored in memory.
 */
function getDeviceId(): string {
  const prefix = Platform.OS === "ios" ? "ios" : "android";
  if (typeof (global as any).__FCM_DEVICE_ID === "string") {
    return (global as any).__FCM_DEVICE_ID;
  }
  const id = `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
  (global as any).__FCM_DEVICE_ID = id;
  return id;
}

/**
 * Request notification permission (iOS) and get FCM token.
 * Saves token to Firestore: users/{uid}/devices/{deviceId}
 * Also updates users/{uid}.token for quick access.
 */
export async function registerForPushNotifications(): Promise<string | null> {
  const uid = auth().currentUser?.uid;
  if (!uid) return null;

  try {
    if (Platform.OS === "ios") {
      const authStatus = await messaging().requestPermission();
      const enabled =
        authStatus === messaging.AuthorizationStatus.AUTHORIZED ||
        authStatus === messaging.AuthorizationStatus.PROVISIONAL;
      if (!enabled) {
        console.log("[push] Notification permission denied");
        return null;
      }
    }

    const token = await messaging().getToken();
    if (!token) {
      console.warn("[push] No FCM token received");
      return null;
    }

    const deviceId = getDeviceId();
    const now = new Date().toISOString();

    const deviceRef = doc(db, "users", uid, DEVICES_COLLECTION, deviceId);
    await setDoc(deviceRef, {
      token,
      platform: Platform.OS,
      updatedAt: now,
    });

    const userRef = doc(db, "users", uid);
    await setDoc(userRef, { token, lastTokenUpdatedAt: now }, { merge: true });

    if (__DEV__) {
      console.log("[push] Token saved for", uid, "device", deviceId);
    }
    return token;
  } catch (error) {
    console.warn("[push] registerForPushNotifications failed:", error);
    return null;
  }
}

/**
 * Remove device token on logout (optional - tokens expire).
 */
export async function removePushToken(): Promise<void> {
  const uid = auth().currentUser?.uid;
  if (!uid) return;

  try {
    const userRef = doc(db, "users", uid);
    await setDoc(userRef, { token: null, lastTokenUpdatedAt: null }, { merge: true });
  } catch (error) {
    console.warn("[push] removePushToken failed:", error);
  }
}

/**
 * Set up token refresh listener and notification handlers.
 * Call after login when user is available.
 */
export function setupPushNotifications(
  onTokenRefresh?: (token: string) => void,
  onNotificationOpened?: (data: Record<string, string>) => void
): () => void {
  const unsubscribeToken = messaging().onTokenRefresh(async (token) => {
    const uid = auth().currentUser?.uid;
    if (!uid) return;

    try {
      const deviceId = getDeviceId();
      const now = new Date().toISOString();
      const deviceRef = doc(db, "users", uid, DEVICES_COLLECTION, deviceId);
      await setDoc(deviceRef, {
        token,
        platform: Platform.OS,
        updatedAt: now,
      });
      const userRef = doc(db, "users", uid);
      await setDoc(userRef, { token, lastTokenUpdatedAt: now }, { merge: true });
      onTokenRefresh?.(token);
      if (__DEV__) console.log("[push] Token refreshed for", uid);
    } catch (error) {
      console.warn("[push] onTokenRefresh save failed:", error);
    }
  });

  const unsubscribeOpened = messaging().onNotificationOpenedApp((remoteMessage) => {
    const data = (remoteMessage?.data as Record<string, string>) ?? {};
    onNotificationOpened?.(data);
  });

  messaging()
    .getInitialNotification()
    .then((remoteMessage) => {
      if (remoteMessage?.data) {
        onNotificationOpened?.(remoteMessage.data as Record<string, string>);
      }
    })
    .catch(() => {});

  return () => {
    unsubscribeToken();
    unsubscribeOpened();
  };
}
