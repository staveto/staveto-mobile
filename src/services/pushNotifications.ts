import { Platform, PermissionsAndroid } from "react-native";
import { doc, setDoc } from "../lib/rnFirestore";
import { getAuth, getFirestore, db } from "../firebase";
import { getExtraEnv } from "../lib/env";
import { isFirebaseAvailable } from "../lib/firebaseAvailable";

function getMessaging(): ReturnType<typeof import("@react-native-firebase/messaging")["default"]> | null {
  if (!isFirebaseAvailable()) return null;
  try {
    return require("@react-native-firebase/messaging").default();
  } catch {
    return null;
  }
}

/** When EXPO_PUBLIC_DISABLE_PUSH=1, all messaging is disabled (test for iOS boot crash). */
function isPushDisabled(): boolean {
  return getExtraEnv("EXPO_PUBLIC_DISABLE_PUSH") === "1";
}

const ANDROID_NOTIFICATION_PERMISSION_API_LEVEL = 33;

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
 * Request notification permission (shows native system dialog).
 * iOS: Firebase messaging.requestPermission()
 * Android 13+: PermissionsAndroid.request(POST_NOTIFICATIONS)
 */
async function requestNotificationPermission(): Promise<boolean> {
  const messaging = getMessaging();
  if (!messaging) return false;
  if (Platform.OS === "ios") {
    const authStatus = await messaging.requestPermission();
    return (
      authStatus === messaging.AuthorizationStatus.AUTHORIZED ||
      authStatus === messaging.AuthorizationStatus.PROVISIONAL
    );
  }
  if (Platform.OS === "android" && Platform.Version >= ANDROID_NOTIFICATION_PERMISSION_API_LEVEL) {
    const result = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS
    );
    return result === PermissionsAndroid.RESULTS.GRANTED;
  }
  return true; // Android < 13: permission granted by default when in manifest
}

/**
 * Request notification permission (iOS) and get FCM token.
 * Saves token to Firestore: users/{uid}/devices/{deviceId}
 * Also updates users/{uid}.token for quick access.
 * Shows native permission dialog at first login (like camera/microphone).
 */
export async function registerForPushNotifications(): Promise<string | null> {
  if (isPushDisabled() || !isFirebaseAvailable()) {
    if (__DEV__ && isPushDisabled()) console.log("[push] Push disabled via env");
    return null;
  }
  const uid = getAuth()?.currentUser?.uid ?? null;
  if (!uid) return null;
  if (!getFirestore()) return null;

  try {
    const granted = await requestNotificationPermission();
    if (!granted) {
      if (__DEV__) console.log("[push] Notification permission denied");
      return null;
    }

    const messaging = getMessaging();
    if (!messaging) return null;
    const token = await messaging.getToken();
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
  if (isPushDisabled() || !isFirebaseAvailable()) return;
  const uid = getAuth()?.currentUser?.uid ?? null;
  if (!uid) return;
  if (!getFirestore()) return;

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
  if (isPushDisabled() || !isFirebaseAvailable()) {
    if (__DEV__ && isPushDisabled()) console.log("[push] Push disabled via env");
    return () => {};
  }
  const messaging = getMessaging();
  if (!messaging) return () => {};
  const unsubscribeToken = messaging.onTokenRefresh(async (token) => {
    const uid = getAuth()?.currentUser?.uid ?? null;
    if (!uid) return;
    if (!getFirestore()) return;

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

  const unsubscribeOpened = messaging.onNotificationOpenedApp((remoteMessage) => {
    const data = (remoteMessage?.data as Record<string, string>) ?? {};
    onNotificationOpened?.(data);
  });

  messaging
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
