import React, { useEffect, useRef } from "react";
import { createNavigationContainerRef } from "@react-navigation/native";
import { auth } from "../firebase";
import { IOS_SKIP_PUSH } from "../lib/iosDiagnostic";
import { getExtraEnv } from "../lib/env";

export const navigationRef = createNavigationContainerRef();

/** When set to "1", prevents Firebase Messaging init at boot (test for iOS crash). */
function isPushDisabled(): boolean {
  return getExtraEnv("EXPO_PUBLIC_DISABLE_PUSH") === "1";
}

/**
 * Sets up push notification handlers. Renders nothing.
 * Navigates to ProjectInvites when user taps a PROJECT_INVITE notification.
 * On iOS diagnostic mode or EXPO_PUBLIC_DISABLE_PUSH=1: skips to avoid loading Firebase Messaging at boot.
 */
export function PushNotificationHandler() {
  const setupDone = useRef(false);

  useEffect(() => {
    if (setupDone.current) return;
    setupDone.current = true;

    if (IOS_SKIP_PUSH || isPushDisabled()) {
      if (isPushDisabled()) console.log("[push] Push disabled via EXPO_PUBLIC_DISABLE_PUSH");
      return () => {};
    }

    let unsubscribe: () => void = () => {};
    import("../services/pushNotifications").then(({ setupPushNotifications }) => {
      unsubscribe = setupPushNotifications(undefined, (data) => {
        const type = data?.type;
        if (!auth()?.currentUser) return;
        if (!navigationRef.isReady()) return;
        if (type === "PROJECT_INVITE" || type === "project_invite") {
          try {
            (navigationRef as any).navigate("ProjectInvites");
          } catch (e) {
            console.warn("[push] Navigate to ProjectInvites failed:", e);
          }
        }
      });
    }).catch((e) => console.warn("[push] setupPushNotifications import failed:", e));

    return () => {
      setupDone.current = false;
      unsubscribe();
    };
  }, []);

  return null;
}
