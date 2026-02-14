import React, { useEffect, useRef } from "react";
import { createNavigationContainerRef } from "@react-navigation/native";
import { setupPushNotifications } from "../services/pushNotifications";
import auth from "@react-native-firebase/auth";

export const navigationRef = createNavigationContainerRef();

/**
 * Sets up push notification handlers. Renders nothing.
 * Navigates to ProjectInvites when user taps a PROJECT_INVITE notification.
 */
export function PushNotificationHandler() {
  const setupDone = useRef(false);

  useEffect(() => {
    if (setupDone.current) return;
    setupDone.current = true;

    const unsubscribe = setupPushNotifications(undefined, (data) => {
      const type = data?.type;

      if (!auth().currentUser) return;
      if (!navigationRef.isReady()) return;

      if (type === "PROJECT_INVITE" || type === "project_invite") {
        try {
          (navigationRef as any).navigate("ProjectInvites");
        } catch (e) {
          console.warn("[push] Navigate to ProjectInvites failed:", e);
        }
      }
    });

    return () => {
      setupDone.current = false;
      unsubscribe();
    };
  }, []);

  return null;
}
