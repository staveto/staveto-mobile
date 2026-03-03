/**
 * App Entry Point
 *
 * CRITICAL: Import order matters!
 * 1. react-native-gesture-handler must load before any screens/components
 * 2. preventAutoHideAsync fire-and-forget (never blocks)
 * 3. Failsafe: splash ALWAYS hides after 3s/10s (runs synchronously)
 * 4. registerRootComponent IMMEDIATELY with lazy App (never wait for async)
 */

// 1) GLOBAL ERROR HANDLER – must be set before any code that might throw
// AsyncStorage deferred (môže crashnúť ak error pred init)
try {
  const RN = require("react-native");
  if (RN.ErrorUtils && typeof RN.ErrorUtils.setGlobalHandler === "function") {
    RN.ErrorUtils.setGlobalHandler((error: unknown, isFatal?: boolean) => {
      const msg = error instanceof Error ? error.message : String(error);
      const stack = error instanceof Error ? error.stack : "";
      console.error("[FATAL]", isFatal, msg, stack);
      setTimeout(() => {
        try {
          const payload = JSON.stringify({ msg, stack, isFatal, ts: Date.now() });
          require("@react-native-async-storage/async-storage").default
            .setItem("staveto_last_error", payload)
            .catch(() => {});
          require("./src/lib/bootLogger").bootFail({ msg, stack, isFatal }).catch(() => {});
        } catch {}
      }, 0);
    });
  }
} catch {}
console.log("[ENTRY] index.ts start");

// Suppress Firebase modular deprecation warnings (we use modular API; lib internals may still log)
(globalThis as any).RNFB_SILENCE_MODULAR_DEPRECATION_WARNINGS = true;

// Initialize Firebase App before any other Firebase modules (prevents iOS Auth crash)
try {
  require("@react-native-firebase/app").getApp();
} catch {}

// Initialize gesture handler (required by React Navigation)
import "react-native-gesture-handler";
// #region agent log
try {
  require("./src/lib/bootLogger").bootStep("entry_start", "H1", {}).catch(() => {});
  require("./src/lib/bootLogger").bootStep("entry_gesture_ok", "H2", {}).catch(() => {});
} catch {}
// #endregion
import { registerRootComponent } from "expo";

// Prevent auto-hide (fire-and-forget – must NOT block; iOS can hang here)
(async () => {
  try {
    const SplashScreen = require("expo-splash-screen");
    await SplashScreen.preventAutoHideAsync?.();
  } catch {}
})();

// Failsafe: hide splash if BootLoader never completes (matches BOOT_TIMEOUT_MS so normal boot hides first)
setTimeout(() => {
  try {
    require("expo-splash-screen").hideAsync?.().catch(() => {});
  } catch {}
}, 8000);
setTimeout(() => {
  try {
    require("expo-splash-screen").hideAsync?.().catch(() => {});
  } catch {}
}, 10000);

// Lazy import App – register IMMEDIATELY so first paint happens; heavy imports load after
registerRootComponent(() => {
  const React = require("react");
  const { useEffect, useState } = React;

  function Entry() {
    const [App, setApp] = useState<React.ComponentType | null>(null);

    useEffect(() => {
      // #region agent log
      try {
        require("./src/lib/bootLogger").bootStep("entry_mounted", "H2", {}).catch(() => {});
      } catch {}
      // #endregion
      // #region agent log
      try {
        require("./src/lib/bootLogger").bootStep("entry_app_loading", "H3", {}).catch(() => {});
      } catch {}
      // #endregion
      import("./App")
        .then((m) => setApp(() => m.default))
        .catch((e) => {
          try {
            require("./src/lib/bootLogger").bootFail(e).catch(() => {});
          } catch {}
        });
      // Splash is hidden by BootLoader when boot completes (not here – avoids "Booting..." flash)
    }, []);

    if (!App) return null;
    return React.createElement(App);
  }

  return React.createElement(Entry);
});
